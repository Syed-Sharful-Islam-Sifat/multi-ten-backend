import { Router } from 'express';
import * as AuthController from '../../controllers/auth.controller';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { loginRateLimit, registerRateLimit } from '../../middleware/rateLimit.middleware';
import { registerSchema, loginSchema } from '../../schemas/auth.schema';

const router = Router();

router.post('/register', registerRateLimit, validate(registerSchema), AuthController.register);
router.post('/login', loginRateLimit, validate(loginSchema), AuthController.login);
router.post('/logout', AuthController.logout);
router.get('/me', requireAuth, AuthController.me);

export default router;
