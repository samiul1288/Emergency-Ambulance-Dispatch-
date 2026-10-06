import type { RequestHandler } from "express";

/**
 * 404 handler for unmatched routes.
 * Standard response structure: { success, message, errors }
 */
export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
    errors: [
      {
        path: req.originalUrl,
        message: `Cannot ${req.method} ${req.originalUrl}`,
      },
    ],
  });
};
