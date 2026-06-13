/**
 * TerminalSessionView — xterm.js instance bound to a PTY session.
 *
 * Lifecycle:
 *   - On mount: create xterm, restore any previously-saved scrollback,
 *     replay pending bytes, open the terminal, attach to PTY data
 *     stream, start ResizeObserver for dynamic fit.
 *   - On unmount: serialize scrollback into the store, dispose xterm.
 *
 * The key invariant for correct history preservation:
 *   1. Write restored state + pending bytes BEFORE `term.open`.
 *   2. Only snapshot scrollback when the xterm has actual content
 *      (skips the React 19 strict-mode double-mount bug).
 */
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import "@xterm/xterm/css/xterm.css";
import { useTerminalStore } from "@/stores/terminal";
import { usePrefsStore } from "@/stores/prefs";

export function TerminalSessionView({ sessionId }: { sessionId: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const send = useTerminalStore((s) => s.send);
  const resize = useTerminalStore((s) => s.resize);
  const setSerializedState = useTerminalStore((s) => s.setSerializedState);
  // Read the current font size from prefs at mount time. We also
  // subscribe below (effect on `fontSize`) so user-driven changes
  // (⌘= / ⌘- / ⌘0) propagate to every live xterm without remounting.
  const fontSize = usePrefsStore((s) => s.terminalFontSize);
  // True once anything has been written to this xterm on the
  // current mount (restored state, pending bytes, or live output).
  // We only snapshot the visual state if there's something worth
  // saving — otherwise React 19 strict mode's mount→cleanup→mount
  // cycle (which runs on every fresh mount in dev) would overwrite
  // the previously-saved scrollback with a fresh empty xterm's
  // state. That bug was masked with a single terminal (the
  // first-time empty is invisible) and blatant with multiple
  // terminals (every pane lost its history on the next switch).
  const hasContentRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new Terminal({
      fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, monospace',
      fontSize,
      cursorBlink: true,
      theme: {
        background: "#101113",
        foreground: "#8A8F98",
        cursor: "#8A8F98",
        selectionBackground: "#3A3D44",
      },
      cols: 80,
      rows: 24,
    });
    const fit = new FitAddon();
    // SerializeAddon snapshots the xterm's visual state (scrollback
    // + cursor). We capture on unmount (so the scrollback survives
    // a worktree switch) and replay on the next mount.
    const serializeAddon = new SerializeAddon();
    term.loadAddon(fit);
    term.loadAddon(serializeAddon);
    hasContentRef.current = false;

    // Register the keystroke handler before open. The textarea
    // xterm uses to capture input only exists once `open` is
    // called, so no keystrokes can land before that — but
    // registering the listener now means it's live the moment
    // open completes.
    const dataDisp = term.onData((data) => {
      const bytes = new TextEncoder().encode(data);
      void send(sessionId, bytes);
    });

    const markContent = () => {
      hasContentRef.current = true;
    };

    // Restore the scrollback + replay pending bytes BEFORE
    // `term.open`. Two reasons:
    //
    //   1. The SerializeAddon docs explicitly recommend it:
    //      "When restoring a terminal it is best to do before
    //      Terminal.open is called to avoid wasting CPU cycles
    //      rendering incomplete frames."
    //
    //   2. More importantly in our case, at the moment this
    //      effect runs the parent SplitView/PaneView has just
    //      been committed but the container's size hasn't been
    //      measured yet — particularly in a split layout, where
    //      the flex math has more work to do. If we call
    //      `fit.fit()` first it can resize the term to 0×0, and
    //      bytes written to a 0×0 buffer are dropped. Writing at
    //      the default 80×24 *before* open means the buffer is
    //      preserved through the open + resize cycle and the
    //      ResizeObserver's later fit reflows it to the real size.
    const prior = useTerminalStore.getState().sessions.get(sessionId)?.serializedState;
    if (prior) {
      markContent();
      try {
        term.write(prior);
      } catch (e) {
        console.warn("xterm write (restored state) failed", e);
      }
    }

    // Attach to the store's PTY data stream and replay any bytes
    // that arrived while the view was unmounted. Doing this
    // before open means those bytes are part of the initial
    // render rather than arriving after.
    const { pending, unsubscribe } = useTerminalStore
      .getState()
      .attachView(sessionId, (bytes) => {
        markContent();
        try {
          term.write(bytes);
        } catch {
          term.write(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
        }
      });
    if (pending.length > 0) {
      markContent();
      try {
        term.write(pending);
      } catch {
        term.write(new TextDecoder("utf-8", { fatal: false }).decode(pending));
      }
    }

    // Now open the term — this flushes the buffer (prior + pending)
    // and renders. We intentionally do NOT call `fit.fit()` here:
    // at this point in the React lifecycle the parent split layout
    // may not have been measured yet, so `getBoundingClientRect()`
    // can return 0×0, 1×1, or any intermediate transient size.
    // Calling fit with a wrong size resizes the xterm buffer and
    // can drop the content we just wrote. The ResizeObserver
    // (which per spec always fires at least once when observation
    // starts on a non-zero-sized element) handles the real fit,
    // and the 50 ms timeout is a belt-and-suspenders fallback.
    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fit;

    const ro = new ResizeObserver(() => {
      try {
        // Terminals on hidden worktrees have zero-size containers
        // (display: none). Skipping fit for those prevents the
        // buffer from being squashed to 0×0. The ResizeObserver
        // fires again when the container becomes visible and the
        // size is real.
        const el = containerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          fit.fit();
          resize(sessionId, term.cols, term.rows);
        }
      } catch {
        // ignore
      }
    });
    ro.observe(containerRef.current);
    const t = window.setTimeout(() => {
      try {
        fit.fit();
        resize(sessionId, term.cols, term.rows);
      } catch {
        // ignore
      }
    }, 50);

    return () => {
      window.clearTimeout(t);
      ro.disconnect();
      dataDisp.dispose();
      unsubscribe();
      // Only snapshot if the xterm actually has visible content.
      // Skipping the empty case is what keeps React 19 strict mode
      // from clobbering a previously-saved scrollback with a
      // freshly-created empty xterm's state. `setSerializedState`
      // is a no-op if the session was already torn down.
      if (hasContentRef.current) {
        try {
          const state = serializeAddon.serialize();
          setSerializedState(sessionId, state);
        } catch (e) {
          console.warn("xterm serialize failed", e);
        }
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId, send, resize, setSerializedState]);

  // Apply live font-size changes (⌘= / ⌘- / ⌘0) to the xterm
  // instance in place. We deliberately do NOT remount on
  // `fontSize` change — remounting would tear down the xterm,
  // dispose its DOM, and lose the in-memory scrollback buffer
  // (the saved serialized state is restored on next mount, but
  // any unflushed TUI app state — alternate screen, etc. — would
  // be clobbered the same way worktree switches used to be).
  // `term.options.fontSize = …` is the cheap path: it just
  // re-measures the canvas. We then `fit.fit()` to re-derive
  // cols/rows from the new cell metrics and push the new size to
  // the backend PTY so the shell knows about it.
  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    try {
      term.options.fontSize = fontSize;
      fit.fit();
      resize(sessionId, term.cols, term.rows);
    } catch {
      // ignore — fit can throw on a hidden (0×0) container;
      // the ResizeObserver handles the real fit when it resurfaces.
    }
  }, [fontSize, sessionId, resize]);

  // Overlay for terminal states (exited / error) — live status comes
  // from the store; we re-read it here so the overlay updates when
  // the session terminates while the pane is still mounted.
  const status = useTerminalStore((s) => s.sessions.get(sessionId)?.status);
  const error = useTerminalStore((s) => s.sessions.get(sessionId)?.error);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {status === "spawning" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-fg-muted">
          Spawning shell…
        </div>
      )}
      {status === "exited" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-fg-subtle">
          Shell exited. Close this pane to clean up.
        </div>
      )}
      {status === "error" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-danger">
          {error || "Failed to spawn shell."}
        </div>
      )}
    </div>
  );
}
