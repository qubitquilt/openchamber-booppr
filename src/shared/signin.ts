import { mountBanner, mountButton, mountSpinner, mountTextField } from "@openchamber/sdk/ui";

import { TENANT_ORIGIN } from "./constants";
import { el } from "./dom";
import { host } from "./host";
import { loadPreferences, savePreferences } from "./preferences";
import { clearLegacyServerUrl } from "./server-url";
import {
  describeServiceError,
  pollSignIn,
  startSignIn,
  type LoginPoll,
  type LoginStart,
} from "./service";
import { parseServerUrl } from "./tenants";

/**
 * The Boop loopback sign-in, the same flow as `boop auth login`: the user
 * names the receiver and the tenant, the service starts a loopback listener
 * and hands back the login URL, the browser bounces through GitHub back to the
 * loopback, and the service trades the one-time code for a session. This draws
 * the fields and drives the polling; the JWT never enters the page.
 *
 * Mount it wherever a surface shows its "not connected" state. The server URL
 * and tenant slug are remembered in the extension's own storage. It calls
 * `onConnected` once the service holds the session, so the surface can reload.
 * The returned function disposes the polling when the surface unmounts.
 */
export function mountSignIn(root: HTMLElement, onConnected: () => void): () => void {
  let disposed = false;
  let runId = 0;
  let timer: number | null = null;
  let serverUrl = "";
  let slug = "";

  const clearTimer = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };
  const active = (id: number) => !disposed && id === runId;
  const render = (node: HTMLElement) => {
    if (!disposed) root.replaceChildren(node);
  };

  const renderIdle = (error?: string) => {
    const card = el("div", { className: "signin-card" });
    card.append(
      el(
        "p",
        { className: "signin-hint" },
        "Connect to your Boop receiver. Your browser will open the receiver's GitHub sign-in and bounce back here.",
      ),
    );
    const urlHolder = el("div", { className: "signin-field" });
    card.append(urlHolder);
    mountTextField(urlHolder, {
      label: "Receiver URL",
      value: serverUrl,
      placeholder: TENANT_ORIGIN,
      mono: true,
      ...(error ? { error } : { helper: "Optional. Defaults to the bundled tenant origin." }),
      onChange: (value) => {
        serverUrl = value;
      },
    });
    const slugHolder = el("div", { className: "signin-field" });
    card.append(slugHolder);
    mountTextField(slugHolder, {
      label: "Tenant slug",
      value: slug,
      placeholder: "qubitquilt",
      mono: true,
      helper: "The tenant to sign in to, as in `boop auth login <tenant>`.",
      onChange: (value) => {
        slug = value;
      },
    });
    const row = el("div", { className: "signin-row" });
    card.append(row);
    mountButton(row, {
      label: "Sign in with Boop",
      size: "sm",
      onClick: () => void begin(),
    });
    render(card);
  };

  const showIdle = async () => {
    const id = ++runId;
    clearTimer();
    const preferences = await loadPreferences().catch(() => null);
    if (!active(id)) return;
    serverUrl = preferences?.serverUrl ?? "";
    slug = preferences?.tenantId ?? "";
    // A pre-fix client could have persisted the old default here — the
    // dedicated API host, where no login can complete. The migration in
    // `server-url.ts` clears it and keeps the rest of the record; the field
    // then shows the bundled tenant origin again.
    if (await clearLegacyServerUrl(host.storage).catch(() => false)) serverUrl = "";
    if (!active(id)) return;
    renderIdle();
  };

  const showError = (message: string, id: number) => {
    if (!active(id)) return;
    clearTimer();
    const holder = el("div", { className: "signin-fill" });
    mountBanner(holder, {
      tone: "error",
      title: "Boop",
      body: message,
      action: { label: "Start again", onClick: () => void showIdle() },
    });
    render(holder);
  };

  const showWaiting = (started: LoginStart, id: number) => {
    if (!active(id)) return;
    const card = el("div", { className: "signin-card" });
    card.append(
      el("p", { className: "signin-hint" }, "Complete the GitHub sign-in in your browser."),
    );
    const row = el("div", { className: "signin-row" });
    card.append(row);
    mountButton(row, {
      label: "Open the sign-in page",
      variant: "secondary",
      size: "sm",
      onClick: () => void host.openUrl(started.loginUrl),
    });
    mountButton(row, {
      label: "Cancel",
      variant: "ghost",
      size: "sm",
      onClick: () => void showIdle(),
    });
    const waiting = el("div", { className: "signin-waiting" });
    card.append(waiting);
    mountSpinner(waiting, { label: "Waiting for the browser" });
    render(card);
  };

  const schedule = (id: number, seconds: number) => {
    clearTimer();
    timer = window.setTimeout(() => void poll(id), Math.max(seconds, 1.5) * 1000);
  };

  const poll = async (id: number) => {
    if (!active(id)) return;
    let result: LoginPoll;
    try {
      result = await pollSignIn();
    } catch (error) {
      showError(describeServiceError(error), id);
      return;
    }
    if (!active(id)) return;
    switch (result.status) {
      case "pending":
        schedule(id, 2);
        return;
      case "connected":
        clearTimer();
        onConnected();
        return;
      default:
        showError(result.message, id);
    }
  };

  const begin = async (): Promise<void> => {
    const parsed = parseServerUrl(serverUrl);
    if (parsed.error) {
      renderIdle(parsed.error);
      return;
    }
    if (!slug.trim()) {
      renderIdle("Enter the tenant slug to sign in to.");
      return;
    }
    const id = ++runId;
    clearTimer();
    await savePreferences({
      serverUrl: serverUrl.trim(),
      tenantId: slug.trim().toLowerCase(),
    }).catch(() => undefined);
    if (!active(id)) return;
    const holder = el("div", { className: "signin-fill" });
    mountSpinner(holder, { label: "Starting sign-in" });
    render(holder);
    let started: LoginStart;
    try {
      started = await startSignIn(parsed.origin, slug.trim().toLowerCase());
    } catch (error) {
      showError(describeServiceError(error), id);
      return;
    }
    if (!active(id)) return;
    showWaiting(started, id);
    schedule(id, 2);
    void host.openUrl(started.loginUrl).catch(() => undefined);
  };

  void showIdle();
  return () => {
    disposed = true;
    clearTimer();
  };
}
