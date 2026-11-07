export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly clientMessage: string;
  readonly retryAfter?: number;

  constructor(
    status: number,
    code: string,
    clientMessage: string,
    retryAfter?: number,
  ) {
    super(clientMessage);
    this.status = status;
    this.code = code;
    this.clientMessage = clientMessage;
    this.retryAfter = retryAfter;
  }
}
