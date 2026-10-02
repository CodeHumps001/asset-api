import { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { HttpError } from '../utils/http';

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ message: 'Route not found' });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message, details: err.details });
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const target = (err.meta?.target as string[] | undefined)?.join(', ') || 'value';
    return res.status(409).json({ message: `A record with this ${target} already exists` });
  }
  console.error('[error]', err);
  res.status(500).json({ message: 'Something went wrong on our side. Please try again.' });
};
