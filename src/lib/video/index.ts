import { isEnabled } from "@/server/flags";
import { NotConfiguredError } from "../errors";
import type { VideoProvider, VideoRoom, VideoRoomRequest } from "./port";

export type { VideoProvider, VideoRoom, VideoRoomRequest } from "./port";

interface VideoConfig {
  apiKey: string | undefined;
}

function readConfig(env: Record<string, string | undefined>): VideoConfig {
  return { apiKey: env.CALVIDEO_API_KEY };
}

function isConfigured(c: VideoConfig): boolean {
  return Boolean(c.apiKey);
}

/** Stub: kaster NotConfiguredError indtil Cal Video er konfigureret. */
class StubVideoProvider implements VideoProvider {
  readonly name = "stub";
  async createRoom(_req: VideoRoomRequest): Promise<VideoRoom> {
    throw new NotConfiguredError("cal-video", "createRoom");
  }
}

// TODO: rigtig Cal Video-adapter når plan/EU-residens er afklaret.
export function createVideoProvider(env: Record<string, string | undefined> = process.env): VideoProvider {
  const config = readConfig(env);
  if (isEnabled("video", env) && isConfigured(config)) {
    // return new CalVideoProvider(config);
  }
  return new StubVideoProvider();
}
