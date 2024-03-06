import { ChatMessageRoleEnum, CortexStep } from "socialagi/next";
import { EnumLike, z } from "zod";

export const decisionWithReason = (context: string, description: string, choices: EnumLike | string[]) => {
  return ({ entityName }: CortexStep<any>) => {
    const params = z.object({
      reason: z.string().describe("The reason for the decision"),
      decision: z.nativeEnum(choices as EnumLike).describe(description),
    });

    return {
      name: "decision_with_reason",
      description: description,
      command: `Model the mind of ${entityName}.

Context: ${context}

${entityName} decided and explained the reason:`,
      parameters: params,
      process: (step: CortexStep<any>, response: z.output<typeof params>) => {
        return {
          value: response,
          memories: [
            {
              role: ChatMessageRoleEnum.Assistant,
              content: `${step.entityName} decided: ${response.decision} because "${response.reason}"`,
            },
          ],
        };
      },
    };
  };
};
