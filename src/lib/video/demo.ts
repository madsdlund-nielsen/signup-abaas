import { demoRef, demoRoomPath } from "../demo";
import type { VideoProvider, VideoRoom, VideoRoomRequest } from "./port";

/** Demo (ADR 0041): møderummet er en side i appen, ikke et Cal Video-rum. */
export class DemoVideoProvider implements VideoProvider {
  readonly name = "demo";

  async createRoom(req: VideoRoomRequest): Promise<VideoRoom> {
    return { id: demoRef("room"), joinUrl: demoRoomPath(req.meetingId) };
  }
}
