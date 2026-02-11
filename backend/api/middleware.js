const crypto = require('crypto');

const DIFFICULTY = '0000';
const CHALLENGE_TTL = 300000;

const activeChallenges = new Map();

function generateChallenge() {
  const challenge = crypto.randomBytes(32).toString('hex');
  activeChallenges.set(challenge, {
    timestamp: Date.now(),
    used: false
  });

  for (const [key, val] of activeChallenges) {
    if (Date.now() - val.timestamp > CHALLENGE_TTL) {
      activeChallenges.delete(key);
    }
  }

  return { challenge, difficulty: DIFFICULTY, ttl: CHALLENGE_TTL };
}

function verifyProofOfWork(challenge, wallet, nonce) {
  const stored = activeChallenges.get(challenge);
  if (!stored) return { valid: false, reason: 'Challenge not found or expired' };
  if (stored.used) return { valid: false, reason: 'Challenge already used' };
  if (Date.now() - stored.timestamp > CHALLENGE_TTL) {
    activeChallenges.delete(challenge);
    return { valid: false, reason: 'Challenge expired' };
  }

  const input = challenge + wallet + nonce;
  const hash = crypto.createHash('sha256').update(input).digest('hex');

  if (!hash.startsWith(DIFFICULTY)) {
    return { valid: false, reason: 'Hash does not start with ' + DIFFICULTY + '. Got: ' + hash.substring(0, 8) + '...' };
  }

  stored.used = true;
  return { valid: true, hash };
}

function machineGate(req, res, next) {
  const { challenge, wallet, nonce } = req.body;
  if (!challenge || !wallet || !nonce) {
    return res.status(400).json({
      error: 'MACHINE_VERIFICATION_REQUIRED',
      message: 'Provide challenge, wallet, and nonce fields',
      hint: 'POST /api/challenge to get a challenge first'
    });
  }

  const result = verifyProofOfWork(challenge, wallet, nonce);
  if (!result.valid) {
    return res.status(403).json({
      error: 'PROOF_OF_WORK_FAILED',
      message: result.reason,
      hint: 'Find nonce where SHA256(challenge + wallet + nonce) starts with 0000'
    });
  }

  req.powHash = result.hash;
  next();
}

module.exports = { generateChallenge, verifyProofOfWork, machineGate };
