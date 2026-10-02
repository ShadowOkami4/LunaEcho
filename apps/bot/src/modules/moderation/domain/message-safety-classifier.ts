export type MessageSafetyLabel = "identity-attack" | "none" | "threat";

export type MessageSafetyAssessment = Readonly<{
  confidence: number;
  label: MessageSafetyLabel;
  provider: string;
}>;

/** Boundary for a local or privately managed message-safety classifier. */
export interface MessageSafetyClassifier {
  classify(content: string): Promise<MessageSafetyAssessment>;
}
