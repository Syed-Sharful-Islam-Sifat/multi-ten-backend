import { Router } from 'express';
import * as PostController from '../../controllers/post.controller';
import { toggleLike, getLikes } from '../../controllers/like.controller';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { createPostRateLimit, createCommentRateLimit } from '../../middleware/rateLimit.middleware';
import { createPostSchema, updatePostSchema } from '../../schemas/post.schema';
import { createCommentSchema } from '../../schemas/comment.schema';
import { upload } from '../../lib/multer';

const router = Router();

router.get('/', requireAuth, PostController.getFeed);

router.post('/', requireAuth, createPostRateLimit, upload.single('image'), validate(createPostSchema), PostController.createPost);
router.get('/:id', requireAuth, PostController.getPost);
router.delete('/:id', requireAuth, PostController.deletePost);
router.patch('/:id', requireAuth, validate(updatePostSchema), PostController.updatePost);

router.post('/:id/like', requireAuth, toggleLike('post'));
router.get('/:id/likes', requireAuth, getLikes('post'));

router.get('/:id/comments', requireAuth, PostController.getComments);
router.post('/:id/comments', requireAuth, createCommentRateLimit, validate(createCommentSchema), PostController.createComment);

export default router;
