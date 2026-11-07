/** Owns one camera stream, including requests that finish after they are canceled. */
export class CameraSession {
  constructor({ mediaDevices = globalThis.navigator?.mediaDevices, onEnded = () => {} } = {}) {
    this.mediaDevices = mediaDevices;
    this.onEnded = onEnded;
    this.stream = null;
    this._generation = 0;
    this._trackCleanups = [];
  }

  async start(constraints) {
    this.stop();
    const generation = this._generation;
    let stream;

    try {
      if (!this.mediaDevices?.getUserMedia) {
        throw new Error('Camera access is unavailable in this browser. Use HTTPS or localhost.');
      }
      stream = await this.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      // A canceled permission request must not replace the current UI with an old error.
      if (generation !== this._generation) return null;
      throw error;
    }

    if (generation !== this._generation) {
      stopTracks(stream);
      return null;
    }

    this.stream = stream;
    for (const track of stream.getVideoTracks()) {
      const handleEnded = () => {
        if (this.stream !== stream || generation !== this._generation) return;
        // Clear ownership before stopping the other tracks: only one callback is allowed.
        this.stop();
        this.onEnded();
      };
      track.addEventListener('ended', handleEnded);
      this._trackCleanups.push(() => track.removeEventListener('ended', handleEnded));
    }
    return stream;
  }

  stop() {
    this._generation += 1;
    const stream = this.stream;
    this.stream = null;
    for (const cleanup of this._trackCleanups.splice(0)) cleanup();
    if (stream) stopTracks(stream);
  }
}

function stopTracks(stream) {
  for (const track of stream.getTracks()) track.stop();
}
