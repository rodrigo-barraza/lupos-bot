// ============================================================
// ButtonRouter — customId-prefix registry for button handlers
// ============================================================
// Replaces the inline if/else chains in luposOnInteractionCreate.
// Handlers register a customId prefix (an exact id works too) and
// the dispatcher routes the first match. Handler errors are
// contained here so a bad button can never crash the process.
// ============================================================

import type { ButtonInteraction, Client } from "discord.js";

export type ButtonHandler = (
  client: Client,
  interaction: ButtonInteraction,
) => Promise<void>;

const handlers: [prefix: string, handler: ButtonHandler][] = [];

const ButtonRouter = {
  /**
   * Register a handler for customIds starting with `prefix`.
   * First registered match wins.
   */
  register(prefix: string, handler: ButtonHandler): void {
    handlers.push([prefix, handler]);
  },

  /**
   * Route a button interaction. Returns true if a handler matched.
   */
  async dispatch(client: Client, interaction: ButtonInteraction): Promise<boolean> {
    for (const [prefix, handler] of handlers) {
      if (interaction.customId.startsWith(prefix)) {
        try {
          await handler(client, interaction);
        } catch (error: unknown) {
          console.error(
            `❌ [ButtonRouter] Handler for "${prefix}" failed on ${interaction.customId}:`,
            error,
          );
        }
        return true;
      }
    }
    return false;
  },

  /** Test hook — clears all registered handlers. */
  _reset(): void {
    handlers.length = 0;
  },
};

export default ButtonRouter;
