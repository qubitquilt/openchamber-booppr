import { host } from "./host";
import { describeServiceError, signOutOfBoop } from "./service";

/**
 * Drop the stored Boop session. The session lives in the local service, so
 * this is a call to it rather than the host's integration session.
 */
export async function disconnect(): Promise<void> {
  try {
    await signOutOfBoop();
  } catch (error) {
    console.error("Disconnect Boop failed:", error);
    await host.toast({
      kind: "error",
      message: `Could not disconnect from Boop. ${describeServiceError(error)}`,
      dismiss: true,
    });
  }
}
