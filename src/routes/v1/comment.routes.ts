import { Router } from 'express';
import * as CommentController from '../../controllers/comment.controller';
import { toggleLike, getLikes } from '../../controllers/like.controller';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { createCommentRateLimit } from '../../middleware/rateLimit.middleware';
import { createCommentSchema } from '../../schemas/comment.schema';

const router = Router();

router.delete('/:id', requireAuth, CommentController.deleteComment);

router.post('/:id/like', requireAuth, toggleLike('comment'));
router.get('/:id/likes', requireAuth, getLikes('comment'));

router.get('/:id/replies', requireAuth, CommentController.getReplies);
router.post('/:id/replies', requireAuth, createCommentRateLimit, validate(createCommentSchema), CommentController.createReply);

export default router;
