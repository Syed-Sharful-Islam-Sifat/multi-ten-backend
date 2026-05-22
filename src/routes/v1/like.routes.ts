import { Router } from 'express';
import * as CommentController from '../../controllers/comment.controller';
import { toggleLike, getLikes } from '../../controllers/like.controller';
import { requireAuth } from '../../middleware/auth.middleware';

const router = Router();

router.delete('/replies/:id', requireAuth, CommentController.deleteReply);

router.post('/replies/:id/like', requireAuth, toggleLike('comment'));
router.get('/replies/:id/likes', requireAuth, getLikes('comment'));

export default router;
