/** React Native's fetch polyfill decodes ArrayBuffer text as Latin-1. File bytes are UTF-8. */
export class AttachmentResponse extends Response {
  private readonly payload: ArrayBuffer;

  /** Takes ownership of a file-read buffer whose caller retains no mutable alias. */
  constructor(payload: ArrayBuffer, init: ResponseInit) {
    super(payload, init);
    this.payload = payload;
  }

  override async text(): Promise<string> {
    return new TextDecoder().decode(await this.arrayBuffer());
  }

  override clone(): AttachmentResponse {
    if (this.bodyUsed) throw new TypeError("Body already consumed");
    return new AttachmentResponse(this.payload, {
      status: this.status,
      statusText: this.statusText,
      headers: this.headers,
    });
  }
}
