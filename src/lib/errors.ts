export class ApiError extends Error {
  statusCode: number;
  field?: string;

  constructor(statusCode: number, message: string, field?: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.field = field;
  }
}
