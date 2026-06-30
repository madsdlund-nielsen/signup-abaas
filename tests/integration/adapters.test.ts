import { describe, expect, it } from "vitest";
import { getAdapters, NotConfiguredError } from "@/lib";

const emptyEnv: Record<string, string | undefined> = {};

describe("adapter-registry uden nøgler/flag", () => {
  it("returnerer stubs for alle sub-processorer", () => {
    const adapters = getAdapters(emptyEnv);
    for (const adapter of Object.values(adapters)) {
      expect(adapter.name).toBe("stub");
    }
  });

  it("fire-and-forget-stub (email) logger og resolver uden at kaste", async () => {
    const { email } = getAdapters(emptyEnv);
    await expect(
      email.send({ to: "x@y.dk", subject: "hej", body: "test" }),
    ).resolves.toBeUndefined();
  });

  it("backend-stub (payments) kaster NotConfiguredError", async () => {
    const { payments } = getAdapters(emptyEnv);
    await expect(
      payments.charge({
        customerRef: "c1",
        amountMinor: 1000,
        currency: "DKK",
        frequencyWeeks: 4,
        description: "test",
      }),
    ).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it("booking-stub kaster NotConfiguredError (multi-host-spike ikke afsluttet)", async () => {
    const { booking } = getAdapters(emptyEnv);
    await expect(
      booking.createMultiHostMeeting({
        ownerUserId: "o",
        partnerUserIds: ["p1", "p2"],
        startsAt: "2026-10-01T09:00:00Z",
        durationMinutes: 75,
      }),
    ).rejects.toBeInstanceOf(NotConfiguredError);
  });
});
