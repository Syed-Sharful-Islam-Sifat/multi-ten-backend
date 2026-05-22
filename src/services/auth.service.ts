import bcrypt from 'bcrypt';
import { User } from '../models/user.model';
import { signToken } from '../lib/jwt';
import { ApiError } from '../lib/errors';
import type { RegisterFormData, LoginFormData } from '../schemas/auth.schema';

const BCRYPT_ROUNDS = 12;

function isMongoDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 11000
  );
}

interface SafeUser {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatar?: string;
}

function formatUser(user: { _id: unknown; firstName: string; lastName: string; email: string; avatar?: string }): SafeUser {
  return {
    _id: String(user._id),
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    avatar: user.avatar,
  };
}

export async function register(input: RegisterFormData): Promise<{ token: string; user: SafeUser }> {
  const existing = await User.findOne({ email: input.email }).lean();
  if (existing) throw new ApiError(409, 'Email already registered', 'email');
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  let user;
  try {
    user = await User.create({
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      passwordHash,
    });
  } catch (err: unknown) {
    if (isMongoDuplicateKeyError(err)) {
      throw new ApiError(409, 'Email already registered', 'email');
    }
    throw err;
  }

  const token = signToken(String(user._id));
  return { token, user: formatUser(user) };
}

export async function login(input: LoginFormData): Promise<{ token: string; user: SafeUser }> {
  const user = await User.findOne({ email: input.email }).select('+passwordHash').lean();

  const passwordHash = user?.passwordHash ?? '$2b$12$invalidhashpaddingtomaintaintiming0000000000000';
  const match = await bcrypt.compare(input.password, passwordHash);
  // if user does not exists still we have compared the password hash with a dummy hash to prevent timing attack.
  // fast failure can leak information
  if (!user || !match) throw new ApiError(401, 'Invalid email or password');

  const token = signToken(String(user._id));
  return { token, user: formatUser(user) };
}

export async function getMe(userId: string): Promise<SafeUser> {
  const user = await User.findById(userId).select('-passwordHash').lean();
  if (!user) throw new ApiError(401, 'Please log in to continue');
  return formatUser(user);
}
