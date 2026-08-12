import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(import.meta.dir, "../../src-tauri/src/lib.rs"),
  "utf8",
);

describe("macOS main-window close lifecycle", () => {
  test("defers hiding a fullscreen window until fullscreen exit completes", () => {
    expect(source).toContain("MAIN_WINDOW_HIDE_REQUEST");
    expect(source).toContain("request_id");
    expect(source).toContain("window.is_fullscreen()");
    expect(source).toContain("window.set_fullscreen(false)");
    expect(source).toContain("wait_for_fullscreen_exit_then_hide");
    expect(source).toContain("tokio::time::sleep");
    expect(source).toContain("is_native_main_window_fullscreen(&window).await");
    expect(source).toContain("NS_WINDOW_STYLE_MASK_FULLSCREEN");
    expect(source).toContain("run_on_main_thread");

    const fullscreenExit = source.indexOf("window.set_fullscreen(false)");
    const deferredTask = source.indexOf(
      "wait_for_fullscreen_exit_then_hide(window, request_id, native_fullscreen)",
      fullscreenExit,
    );
    const helper = source.indexOf("async fn wait_for_fullscreen_exit_then_hide");
    const stateCheck = source.indexOf(
      "is_native_main_window_fullscreen(&window).await",
      helper,
    );
    const deferredHide = source.indexOf(
      "hide_main_window_for_request(&window, request_id)",
      stateCheck,
    );

    expect(fullscreenExit).toBeGreaterThan(-1);
    expect(deferredTask).toBeGreaterThan(fullscreenExit);
    expect(stateCheck).toBeGreaterThan(helper);
    expect(deferredHide).toBeGreaterThan(stateCheck);

    const waiterEnd = source.indexOf("async fn handle_main_window_close", helper);
    const waiterSource = source.slice(helper, waiterEnd);
    expect(waiterSource).not.toContain("window.is_fullscreen()");
    expect(waiterSource).toContain("is_current_main_window_hide(request_id)");
    expect(waiterSource).toContain("finish_main_window_hide(request_id)");

    const closeHandler = source.slice(
      source.indexOf('.on_window_event(|window, event|'),
      source.indexOf('.invoke_handler(', source.indexOf('.on_window_event(|window, event|')),
    );
    expect(closeHandler).not.toContain("window.is_fullscreen()");
    expect(closeHandler).not.toContain("window.hide()");
    expect(closeHandler).toContain("begin_main_window_hide()");
    expect(closeHandler).toContain("handle_main_window_close");
  });

  test("cancels a pending hide if exiting fullscreen fails", () => {
    const exitFailure = source.indexOf("Failed to exit fullscreen before hiding");
    expect(exitFailure).toBeGreaterThan(-1);

    const cancellation = source.lastIndexOf(
      "finish_main_window_hide(request_id)",
      exitFailure,
    );
    expect(cancellation).toBeGreaterThan(-1);
  });

  test("an older close task cannot clear a newer request", () => {
    expect(source).toContain("AtomicU64");
    expect(source).toContain("compare_exchange(request_id, 0");
    expect(source).toContain("MAIN_WINDOW_HIDE_REQUEST.store(0");
  });

  test("serializes hiding and reopening on the main thread", () => {
    const traySource = readFileSync(
      resolve(import.meta.dir, "../../src-tauri/src/tray.rs"),
      "utf8",
    );
    const hideHelper = source.slice(
      source.indexOf("fn hide_main_window_for_request"),
      source.indexOf("async fn wait_for_fullscreen_exit_then_hide"),
    );
    const focusHelper = traySource.slice(
      traySource.indexOf("pub(crate) fn focus_main_window"),
    );

    expect(hideHelper).toContain("run_on_main_thread");
    expect(hideHelper.indexOf("is_current_main_window_hide(request_id)")).toBeLessThan(
      hideHelper.indexOf("window_for_hide.hide()"),
    );
    expect(focusHelper).toContain("run_on_main_thread");
    expect(focusHelper.indexOf("cancel_pending_main_window_hide()")).toBeLessThan(
      focusHelper.indexOf("window_for_focus.show()"),
    );
  });
});
