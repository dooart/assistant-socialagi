import { ChatMessageRoleEnum, CortexStep, z } from "socialagi/next";

export default function saveReasonObjectiveNotAchieved() {
  return ({ entityName }: CortexStep<any>) => {
    const params = z.object({
      reason: z.string().describe(`The reason why ${entityName}'s objective wasn't achieved`),
    });

    return {
      name: `save_reason_not_achieved`,
      description: `Save the reason why ${entityName}'s objective wasn't achieved`,
      parameters: params,
      command: `In just a few words, identify the reason why ${entityName}'s objective wasn't achieved from their recent interaction with the user.`,
      process: (step: CortexStep<any>, response: z.output<typeof params>) => {
        return {
          value: response.reason,
          memories: [
            {
              role: ChatMessageRoleEnum.System,
              content: `The reason provided for ${entityName} not achieving its objective is: "${response.reason}".`,
            },
          ],
        };
      },
    };
  };
}
