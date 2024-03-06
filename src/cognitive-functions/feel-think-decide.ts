import { ChatMessageRoleEnum, CortexStep } from "socialagi/next";
import { EnumLike, z } from "zod";

export const feelThinkDecide = (objective: string, choices: EnumLike | string[]) => {
  return ({ entityName }: CortexStep<any>) => {
    const params = z.object({
      feeling: z
        .string()
        .describe("How the entity feels about the user's response considering their current objective"),
      thought: z
        .string()
        .describe("What the entity thinks about their feelings, their current objective, and what the user just said"),
      reason: z.string().describe("The reason for the decision"),
      decision: z
        .nativeEnum(choices as EnumLike)
        .describe(`Did the entity achieve their current objective of ${objective}?`),
    });

    return {
      name: "feel_think_decide",
      description: `Model the mind of ${entityName}.

## Rules
* All thoughts should match the speaking style of ${entityName}.
* Only respond with the format '${entityName} [verb]: "..."', no additonal commentary or text.
* Verbs: 'felt', 'thought', 'decided'.
* Follow the Description when creating the internal thought!

Current Objective: ${objective}
1. Considering their current objective, how does ${entityName} feel about the user's response?
2. What does ${entityName} think about their feelings, their current objective, and what the user just said?
3. Based on their thoughts, did ${entityName} achieve their current objective? Provide a reason for the decision.`,
      commandRole: ChatMessageRoleEnum.System,
      parameters: params,
      process: (step: CortexStep<any>, response: z.output<typeof params>) => {
        return {
          value: {
            reason: response.reason,
            decision: response.decision,
          },
          memories: [
            {
              role: ChatMessageRoleEnum.Assistant,
              content: `${step.entityName} felt: ${response.feeling}`,
            },
            {
              role: ChatMessageRoleEnum.Assistant,
              content: `${step.entityName} thought: ${response.thought}`,
            },
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
