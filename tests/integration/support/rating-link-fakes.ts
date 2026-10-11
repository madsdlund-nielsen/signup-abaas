import type { LinkRater } from "@/server/ratings/link";
import type { CreateLinkInput, RatingLinkRecord, RatingLinkStore } from "@/server/ratings/link-store";

/**
 * In-memory-lager til rating-linkene. Spejler de regler `redeem_rating_link` (0023) håndhæver i
 * basen — ubrugt, ikke udløbet, mødet afholdt — så servicelaget kan testes uden Postgres. De
 * rigtige garantier (atomicitet under samtidighed, RLS) testes i tests/db/rating-link-rls.test.ts.
 */
export interface StoredRating {
  meetingId: string;
  rater: LinkRater;
  score: number;
  comment: string | null;
}

export class MemoryRatingLinkStore implements RatingLinkStore {
  links: RatingLinkRecord[] = [];
  /** Én række pr. (møde, rater) — spejler `meeting_rating_unique_per_subject` for subject = null. */
  ratings = new Map<string, StoredRating>();
  redeemCalls = 0;
  private nextId = 1;

  constructor(private readonly clock: { now: Date }) {}

  private static raterKey(meetingId: string, rater: LinkRater): string {
    return `${meetingId}:${rater.kind === "user" ? `user:${rater.userId}` : `partner:${rater.partnerProfileId}`}`;
  }

  /** Opret et møde-link direkte (til tests der selv styrer udløb og status). */
  seed(overrides: Partial<RatingLinkRecord> & Pick<RatingLinkRecord, "rater">): RatingLinkRecord {
    const id = `00000000-0000-4000-8000-${String(this.nextId++).padStart(12, "0")}`;
    const record: RatingLinkRecord = {
      id,
      meetingId: "00000000-0000-0000-0000-0000000f0002",
      expiresAt: new Date(this.clock.now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      usedAt: null,
      meeting: { startsAt: "2026-10-09T10:00:00.000Z", status: "afholdt", boardName: "[DEMO] Testboard" },
      ...overrides,
    };
    this.links.push(record);
    return record;
  }

  async getOrCreate({ meetingId, rater, expiresAt }: CreateLinkInput): Promise<RatingLinkRecord> {
    const key = MemoryRatingLinkStore.raterKey(meetingId, rater);
    const existing = this.links.find((l) => MemoryRatingLinkStore.raterKey(l.meetingId, l.rater) === key);
    if (existing) return existing;
    return this.seed({ meetingId, rater, expiresAt: expiresAt.toISOString() });
  }

  async find(id: string): Promise<RatingLinkRecord | null> {
    return this.links.find((l) => l.id === id) ?? null;
  }

  async redeem(id: string, score: number, comment: string | null): Promise<string | null> {
    this.redeemCalls += 1;
    const link = this.links.find((l) => l.id === id);
    if (!link) return null;
    if (link.usedAt !== null) return null;
    if (new Date(link.expiresAt).getTime() <= this.clock.now.getTime()) return null;
    if (link.meeting?.status !== "afholdt") return null;

    link.usedAt = this.clock.now.toISOString();
    this.ratings.set(MemoryRatingLinkStore.raterKey(link.meetingId, link.rater), {
      meetingId: link.meetingId,
      rater: link.rater,
      score,
      comment,
    });
    return `rating-${this.ratings.size}`;
  }
}
