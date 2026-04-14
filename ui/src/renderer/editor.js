import { Editor, rootCtx, defaultValueCtx } from "@milkdown/core";
import {
  commonmark,
  toggleStrongCommand,
  toggleEmphasisCommand,
  wrapInHeadingCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInBlockquoteCommand,
  createCodeBlockCommand,
  toggleInlineCodeCommand,
} from "@milkdown/preset-commonmark";
import { gfm, toggleStrikethroughCommand } from "@milkdown/preset-gfm";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { history, undoCommand, redoCommand } from "@milkdown/plugin-history";
import { nord } from "@milkdown/theme-nord";
import { callCommand, getMarkdown, replaceAll } from "@milkdown/utils";

// Import Nord base styles then layer our own theme on top
import "@milkdown/theme-nord/style.css";

let editorInstance = null;

const WELCOME = `# Welcome to Second Brian — the better brain!

Start capturing your thoughts. This editor works like **Typora** — write markdown and it renders inline.

## Quick tips

- Use **Ctrl+B** for bold, **Ctrl+I** for italic
- Use the toolbar above for headings, lists, and code blocks
- Press **Ctrl+K** to open the command palette
- Press **Ctrl+Shift+S** to save the current document as a thought

> Your second brain is ready. What are you thinking about?
`;

export async function initEditor({ container, onChange }) {
  editorInstance = await Editor.make()
    .config(nord)
    .config((ctx) => {
      ctx.set(rootCtx, container);
      ctx.set(defaultValueCtx, WELCOME);
      ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
        if (onChange) onChange(markdown);
      });
    })
    .use(listener)
    .use(commonmark)
    .use(gfm)
    .use(history)
    .create();

  return {
    getMarkdown() {
      return editorInstance.action(getMarkdown());
    },

    setMarkdown(md) {
      editorInstance.action(replaceAll(md ?? ""));
    },

    undo() {
      editorInstance.action(callCommand(undoCommand.key));
    },

    redo() {
      editorInstance.action(callCommand(redoCommand.key));
    },

    execCommand(cmd) {
      try {
        const e = editorInstance;
        switch (cmd) {
          case "strong":
            e.action(callCommand(toggleStrongCommand.key));
            break;
          case "em":
            e.action(callCommand(toggleEmphasisCommand.key));
            break;
          case "strike":
            e.action(callCommand(toggleStrikethroughCommand.key));
            break;
          case "code_inline":
            e.action(callCommand(toggleInlineCodeCommand.key));
            break;
          case "h1":
            e.action(callCommand(wrapInHeadingCommand.key, 1));
            break;
          case "h2":
            e.action(callCommand(wrapInHeadingCommand.key, 2));
            break;
          case "h3":
            e.action(callCommand(wrapInHeadingCommand.key, 3));
            break;
          case "bullet_list":
            e.action(callCommand(wrapInBulletListCommand.key));
            break;
          case "ordered_list":
            e.action(callCommand(wrapInOrderedListCommand.key));
            break;
          case "blockquote":
            e.action(callCommand(wrapInBlockquoteCommand.key));
            break;
          case "code_block":
            e.action(callCommand(createCodeBlockCommand.key));
            break;
          default:
            console.warn("[editor] unknown command:", cmd);
        }
      } catch (err) {
        console.warn("[editor] command failed:", cmd, err);
      }
    },
  };
}
