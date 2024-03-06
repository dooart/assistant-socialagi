import { AbortSignal } from "abort-controller";
import { config } from "dotenv";
import * as readline from "readline";
import {
  AnthropicProcessor,
  ChatMessage,
  ChatMessageRoleEnum,
  CortexScheduler,
  CortexStep,
  externalDialog,
  internalMonologue,
} from "socialagi/next";
import { SpanProcessorType, startInstrumentation } from "socialagi/next/instrumentation";
import { AiBlueprint, blueprintToChatMessage, freddyBlueprint } from "./blueprint";
import { decisionWithReason } from "./cognitive-functions/decision-with-reason";
import saveCheckInTime from "./cognitive-functions/save-checkin-time";
import saveReasonObjectiveNotAchieved from "./cognitive-functions/save-reason-objective-not-achieved";
import saveUserGoals from "./cognitive-functions/save-user-goals";

startInstrumentation({
  spanProcessorType: SpanProcessorType.Simple,
});

type GenericCortexStep = CortexStep<any>;

type MentalProcess = (
  signal: AbortSignal,
  newMemory: ChatMessage,
  lastStep: GenericCortexStep
) => Promise<GenericCortexStep>;

type Decision = "objective_achieved" | "objective_partially_achieved" | "objective_not_aligned";

type ObjectiveSettings = {
  description: string;
  details?: string;
  acceptance: [string, ...string[]];
  attemptLimit: number;
};

type Objective = "SET_GOALS" | "REVIEW_GOALS";

const Objectives: Record<Objective, ObjectiveSettings> = {
  SET_GOALS: {
    description: "collecting user goals",
    acceptance: ["at least 1 goal", "no more than 3 goals"],
    attemptLimit: 5,
  },
  REVIEW_GOALS: {
    description: "finding out which goals were achieved",
    details: "if a goal was partially achieved, ask the user if they consider it a success or a failure",
    acceptance: ["should know how exactly how many goals were achieved"],
    attemptLimit: 5,
  },
};

function initCortex(
  blueprint: AiBlueprint,
  streamMessageToUser: (stream: AsyncIterable<string>) => Promise<void>,
  finishFlow: <T>(step: CortexStep<T>) => CortexStep<T>
) {
  const systemMessage = blueprintToChatMessage(blueprint);
  const initialMemories = [systemMessage];

  let firstStep = new CortexStep(blueprint.name, {
    processor: new AnthropicProcessor(),
  });
  firstStep = firstStep.withMemory(initialMemories);
  const cortex = new CortexScheduler(firstStep);

  let objective: Objective = "SET_GOALS";
  let attempts = 0;

  const greet: MentalProcess = async (_signal, _newMemory, lastStep) => {
    const { nextStep: greet, stream } = await lastStep.next(
      externalDialog(`${blueprint.name} greets the user and directly asks for 1-3 goals for the day`),
      { stream: true }
    );

    await streamMessageToUser(stream);

    return await greet;
  };

  const respond: MentalProcess = async (_signal, newMemory, lastStep) => {
    const step = lastStep.withMemory([newMemory]);

    const objectiveDescription = describeObjectiveWithDetails(objective);

    const reflect = await step.next(
      internalMonologue(
        `${blueprint.name} reflects about their current objective of ${objectiveDescription}, and what the user just said`,
        "thought"
      )
    );

    const decisionOptions: Decision[] = ["objective_achieved", "objective_partially_achieved", "objective_not_aligned"];

    const decisionOptionsDescriptions: Record<Decision, string> = {
      objective_achieved: `The user's response has fully met the specified criteria for the current objective.`,
      objective_partially_achieved: `The user's response partially meets the criteria for the current objective, indicating progress in the right direction but not full completion.`,
      objective_not_aligned: `The user's response does not align with the objective or the criteria.`,
    };

    const decisionOptionsDescriptionString = `Decision description:\n${decisionOptions
      .map((decision) => `- ${decisionOptionsDescriptions[decision]}`)
      .join("\n")}`;

    const context = `${decisionOptionsDescriptionString}\n${blueprint.name}'s current objective: ${objectiveDescription}`;

    const decide = await reflect.next(
      decisionWithReason(
        context,
        `Considering ${blueprint.name}'s thoughts and the provided guidelines, determine the alignment of the user's response with the current objective.`,
        decisionOptions
      ),
      { tags: { decision: "objective" } }
    );

    const decision = decide.value.decision as Decision;

    if (decision === "objective_achieved") {
      return handleObjectiveAchieved(decide);
    } else if (decision === "objective_partially_achieved") {
      return handleObjectiveNotAchivedYet(decide);
    } else {
      const notAchieved = await decide.next(saveReasonObjectiveNotAchieved());
      const reasonNotAchieved = notAchieved.value;
      return handleCancelObjective(notAchieved, reasonNotAchieved);
    }
  };

  const summarizeObjective = (objective: Objective) => {
    return Objectives[objective].description;
  };

  const describeObjectiveWithDetails = (objective: Objective) => {
    const objectiveSettings = Objectives[objective];

    const description = `Objective: ${objectiveSettings.description}`;
    const details = objectiveSettings.details ? `Objective details: ${objectiveSettings.details}` : "";
    const acceptance = `Acceptance criteria: ${objectiveSettings.acceptance.join(", ")}`;

    return [description, details, acceptance].filter(Boolean).join("\n");
  };

  const handleObjectiveAchieved = async (lastStep: GenericCortexStep) => {
    if (objective === "SET_GOALS") {
      const saved = await lastStep.next(saveUserGoals());

      const { nextStep: acknowledge, stream } = await saved.next(
        externalDialog(
          `${blueprint.name} tells the user they'll check in at the end of the day, or the next morning if it's past 4pm`
        ),
        {
          stream: true,
        }
      );

      await streamMessageToUser(stream);

      const endInteraction = await acknowledge;

      return finishFlow(endInteraction);
    } else if (objective === "REVIEW_GOALS") {
      const saved = await lastStep.next(saveCheckInTime());

      const { nextStep: acknowledge, stream } = await saved.next(
        externalDialog(`${blueprint.name} tells the user they'll check in at ${saved.value} (in human-readble format)`),
        { stream: true }
      );

      await streamMessageToUser(stream);

      const endInteraction = await acknowledge;

      return finishFlow(endInteraction);
    } else {
      throw new Error("not implemented");
    }
  };

  const handleObjectiveNotAchivedYet = async (lastStep: GenericCortexStep) => {
    attempts++;

    const notAchieved = await lastStep.next(saveReasonObjectiveNotAchieved());

    if (attempts >= Objectives[objective].attemptLimit) {
      const reasonNotAchieved = notAchieved.value;
      return handleCancelObjective(notAchieved, reasonNotAchieved);
    }

    const think = await notAchieved.next(
      internalMonologue(
        `considering the fact their objective wasn't achieved because of ${notAchieved.value}, ${
          blueprint.name
        } thinks about what they'll say so in the next reply the user helps them accomplish ${summarizeObjective(
          objective
        )}`
      )
    );

    const { nextStep: nudge, stream } = await think.next(
      externalDialog(
        `based on their thoughts, ${
          blueprint.name
        } professionally nudges the user towards helping them achieve their current objective of ${summarizeObjective(
          objective
        )}`
      ),
      { stream: true }
    );

    await streamMessageToUser(stream);

    return await nudge;
  };

  const handleCancelObjective = async (lastStep: GenericCortexStep, reasonNotAchieved: string) => {
    const { trustLevel } = blueprint.settings;

    const days = trustLevel > 0.5 ? "tomorrow" : `in ${trustLevel <= 0.5 ? 3 : 7} days`;

    const { nextStep: abort, stream } = await lastStep.next(
      externalDialog(
        `based on their thoughts and the fact their objective wasn't achieved because of ${reasonNotAchieved}, ${
          blueprint.name
        } briefly communicates they're giving up on ${summarizeObjective(objective)}. ${
          blueprint.name
        } does NOT ask any more questions, does NOT lecture the user, just finishes the conversation saying  that they will reach out again ${days}. `
      ),
      { stream: true }
    );

    await streamMessageToUser(stream);

    const endInteraction = await abort;

    console.log("END FLOW - objective not achieved");

    return finishFlow(endInteraction);
  };

  cortex.register({
    name: "greet",
    process: greet,
  });

  cortex.register({
    name: "respond",
    process: respond,
  });

  return cortex;
}

export function newAssistant({
  onMessagePart,
  onFinishedSendingMessage,
  onFinishedFlow,
}: {
  onMessagePart: (text: string) => void;
  onFinishedSendingMessage?: () => void;
  onFinishedFlow: <T>(step: CortexStep<T>) => CortexStep<T>;
}) {
  const blueprint = freddyBlueprint;

  async function streamMessageToUser(stream: AsyncIterable<string>): Promise<void> {
    for await (const chunk of stream) {
      onMessagePart(chunk);
    }

    if (onFinishedSendingMessage) {
      onFinishedSendingMessage();
    }
  }

  return initCortex(blueprint, streamMessageToUser, onFinishedFlow);
}

export function run() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const callbacks = {
    onMessagePart: (text: string) => process.stdout.write(text),
    onFinishedSendingMessage: () => process.stdout.write("\n\nYour message:\n"),
    onFinishedFlow: <T>(step: CortexStep<T>) => {
      console.log("conversation finished");
      rl.close();
      return step;
    },
  };

  let conversation = newAssistant(callbacks);

  conversation.dispatch("greet", {
    role: ChatMessageRoleEnum.System,
    content: "it's time to collect user goals for the day",
  });

  console.log('- Type a message to send to assistant\n- Type "reset" to reset\n- Type "exit" to quit\n');

  rl.on("line", async (line) => {
    if (line.toLowerCase() === "exit") {
      rl.close();
    } else if (line.toLowerCase() === "reset") {
      conversation = newAssistant(callbacks);
    } else {
      console.log();

      const text: string = line;
      conversation.dispatch("respond", {
        role: ChatMessageRoleEnum.User,
        content: text,
      });
    }
  });
}
