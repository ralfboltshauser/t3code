import { expect } from "e2e";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { T3_HOME } from "../e2e.config.ts";
import { runPromise, test, WEB } from "./t3.ts";

test(
  "The configured settle shortcut closes a side chat and its status indicator can reopen it",
  WEB,
  async ({ t3, app, browser, screen }) => {
    const binding = await runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const file = (yield* Path.Path).join(T3_HOME, "userdata/keybindings.json");
        const original = (yield* fs.exists(file)) ? yield* fs.readFileString(file) : null;
        yield* fs.writeFileString(
          file,
          '[{ "key": "mod+e", "command": "thread.settle", "when": "!terminalFocus" }]\n',
        );
        return {
          restore:
            original === null
              ? fs.remove(file, { force: true })
              : fs.writeFileString(file, original),
        };
      }),
    );
    try {
      const project = await t3.project("demo");
      const parent = await t3.thread({ project, title: "Main work", messages: ["Start"] });
      await t3.open("/settings/keybindings");
      await screen.getByRole("button", /Edit shortcut for Thread: Settle:.*E/).waitFor();
      await t3.open(parent);
      const mainComposer = screen.getByRole("textbox");
      await mainComposer.fill("/side Explain the result");
      await mainComposer.press("Enter");
      const pane = browser.locator("[data-side-chat-pane]");
      await expect(pane).toBeVisible();
      await expect(pane.getByText("fixture turn complete", { exact: false })).toBeVisible();
      await app.screenshot("side-chat-before-settle");
      await pane.getByRole("textbox").tap();
      await browser.keyboard.press("ControlOrMeta+E");
      await expect(pane).toBeHidden();
      await app.screenshot("side-chat-settled");
      const indicator = screen.getByRole("button", /^Side chats: 1 chat:/);
      await expect(indicator).toBeVisible();
      await indicator.tap();
      await app.screenshot("side-chat-status-breakdown");
      await screen.getByRole("menuitem", /Explain the result|Side chat/).tap();
      await expect(pane).toBeVisible();
      await expect(pane.getByText("fixture turn complete", { exact: false })).toBeVisible();
      await app.screenshot("side-chat-reopened-with-history");
      await expect(pane.getByRole("button", "Un-settle", { exact: true })).toBeVisible();
      await pane.getByRole("textbox").tap();
      await browser.keyboard.press("ControlOrMeta+E");
      await expect(pane).toBeHidden();
      await t3.open("/settings/labs");
      await screen.getByRole("switch", "Boring sidebar (group by project)").tap();
      await t3.open(parent);
      await expect(indicator).toBeVisible();
      await indicator.tap();
      await app.screenshot("boring-sidebar-side-chat-status");
      await screen.getByRole("menuitem", /Explain the result|Side chat/).tap();
      await expect(pane).toBeVisible();
    } finally {
      await runPromise(binding.restore);
    }
  },
);
