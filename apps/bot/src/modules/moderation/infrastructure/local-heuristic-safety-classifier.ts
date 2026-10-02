import type {
  MessageSafetyAssessment,
  MessageSafetyClassifier,
} from "../domain/message-safety-classifier.js";

const directThreatPatterns = [
  /\b(?:i(?:'ll|\s+will|\s+am\s+going\s+to)|i'm\s+going\s+to)\s+(?:kill|murder|shoot|stab|hurt)\s+(?:you|u)\b/iu,
  /\b(?:ich\s+werde\s+dich|ich\s+bring(?:e)?\s+dich)\s+(?:töten|umbringen|erschießen|erstechen|verletzen|um)\b/iu,
] as const;

const identityTerms = [
  "black people",
  "christians",
  "disabled people",
  "gay people",
  "immigrants",
  "jews",
  "muslims",
  "refugees",
  "trans people",
  "white people",
  "behinderte menschen",
  "christen",
  "flüchtlinge",
  "homosexuelle",
  "immigranten",
  "juden",
  "muslime",
  "transmenschen",
] as const;

const escapedIdentityTerms = identityTerms.map((term) =>
  term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
);
const identityAttackPattern = new RegExp(
  `\\b(?:all|every|alle|jede[nr]?)\\s+(?:${escapedIdentityTerms.join("|")})\\s+(?:should|must|deserve\\s+to|sollten|müssen|verdienen\\s+es)\\s+(?:die|be\\s+killed|sterben|getötet\\s+werden)\\b`,
  "iu",
);

/**
 * Conservative, transparent fallback for self-hosted deployments.
 * It intentionally matches only explicit high-confidence constructions.
 */
export class LocalHeuristicSafetyClassifier implements MessageSafetyClassifier {
  public classify(content: string): Promise<MessageSafetyAssessment> {
    const normalized = content.normalize("NFKC").replace(/\s+/gu, " ").trim();

    if (directThreatPatterns.some((pattern) => pattern.test(normalized))) {
      return Promise.resolve({ confidence: 0.98, label: "threat", provider: "local-heuristic" });
    }

    if (identityAttackPattern.test(normalized)) {
      return Promise.resolve({
        confidence: 0.98,
        label: "identity-attack",
        provider: "local-heuristic",
      });
    }

    return Promise.resolve({ confidence: 0, label: "none", provider: "local-heuristic" });
  }
}
