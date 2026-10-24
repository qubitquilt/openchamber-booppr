import { connectHost } from "@openchamber/sdk";

/**
 * One host client per iframe. Every surface (rail panel, attach dialog,
 * full-screen page, background frame) gets its own sandbox, so this module is
 * imported once per bundle and never shared across surfaces.
 */
export const host = connectHost();
