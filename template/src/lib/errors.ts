export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly clientMessage: string;

  constructor(status: number, code: string, clientMessage: string) {
    super(clientMessage);
    this.status = status;
    this.code = code;
    this.clientMessage = clientMessage;
  }
}
