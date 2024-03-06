import { ChatMessageRoleEnum, CortexStep, z } from "socialagi/next";

export default function saveUserGoals() {
  return ({ entityName }: CortexStep<any>) => {
    const params = z.object({
      userGoals: z
        .array(z.string())
        .describe(`A list collected by ${entityName} containing the user's goals for today`),
    });

    return {
      name: `save_user_goals`,
      description: `Save the user's goals for today`,
      parameters: params,
      command: `Identify the goals that were just collected by ${entityName}. List them in a structured manner.`,
      process: (step: CortexStep<any>, response: z.output<typeof params>) => {
        return {
          value: response.userGoals,
          memories: [
            {
              role: ChatMessageRoleEnum.System,
              content: `${entityName} collected the following goals from the user:\n${response.userGoals
                .map((goal) => `- ${goal}`)
                .join("\n")}`,
            },
          ],
        };
      },
    };
  };
}
