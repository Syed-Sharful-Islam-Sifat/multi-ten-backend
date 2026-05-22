import 'express';

declare module 'express' {
  interface Request {
    currentUser?: {
      _id: string;
      firstName: string;
      lastName: string;
      email: string;
      avatar?: string;
    };
  }
}
