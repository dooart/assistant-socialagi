import { ChatMessageRoleEnum, CortexStep, z } from "socialagi/next";

export default function saveCheckInTime() {
  return ({ entityName }: CortexStep<any>) => {
    const params = z.object({
      checkInTime: z.string().describe("The ISO date string indicating when the user would like to be checked in on."),
    });

    return {
      name: `save_check_in_time`,
      description: `Save a *VALID* ISO date string indicating the desired check-in time`,
      parameters: params,
      command: `In response to the message from ${entityName} asking about a check-in time, identify the time when the user would like the check-in to happen and convert it to a timestamp. Take into account the user's local time.`,
      process: (step: CortexStep<any>, response: z.output<typeof params>) => {
        return {
          value: response.checkInTime,
          memories: [
            {
              role: ChatMessageRoleEnum.System,
              content: `${step.entityName} was informed to check in with the user on: ${response.checkInTime}`,
            },
          ],
        };
      },
    };
  };
}
