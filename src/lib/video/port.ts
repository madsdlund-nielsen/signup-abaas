export interface VideoRoomRequest {
  meetingId: string;
}

export interface VideoRoom {
  id: string;
  joinUrl: string;
}

/**
 * Multi-party video. Leverandør: Cal Video (Cal.com er ansvarlig for optagelse).
 * TODO(mads): EU-residens + mødeoptagelse på valgt Cal.com-plan (samme spike
 * som booking). Branded RealtimeKit-lag er et senere flag, kun hvis Cal Video
 * underleverer.
 */
export interface VideoProvider {
  readonly name: string;
  createRoom(req: VideoRoomRequest): Promise<VideoRoom>;
}
