/**
 * Feedback API: submit thumbs up/down and optional comment (public).
 * Admin listing is under GET /api/admin/feedback.
 */
import express from 'express';
import { addFeedback, addCommentToFeedback } from '../storage/feedback.js';

const router = express.Router();

/**
 * POST /api/feedback
 * Body: { feedback: 'up'|'down', userPrompt: string, agentResponse: string }
 * Returns: { id: string }
 */
router.post('/', (req, res) => {
  try {
    const { feedback, userPrompt, agentResponse } = req.body || {};
    if (!feedback || !['up', 'down'].includes(feedback)) {
      res.status(400).json({ error: 'feedback must be "up" or "down"' });
      return;
    }
    const { id } = addFeedback({ feedback, userPrompt, agentResponse });
    res.json({ id });
  } catch (err) {
    console.error('Feedback submit error:', err.message);
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});

/**
 * POST /api/feedback/:id/comment
 * Body: { comment: string }
 * Returns: { ok: boolean }
 */
router.post('/:id/comment', (req, res) => {
  try {
    const id = req.params.id;
    const comment = req.body?.comment != null ? String(req.body.comment) : '';
    const result = addCommentToFeedback(id, comment);
    if (!result.ok) {
      res.status(404).json({ error: 'Feedback not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Feedback comment error:', err.message);
    res.status(500).json({ error: 'Failed to save comment' });
  }
});

export default router;
