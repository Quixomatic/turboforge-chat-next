import {
  appendClientMessage,
  appendResponseMessages,
  createDataStream,
  smoothStream,
  streamText,
} from "ai";
import { auth, type UserType } from "@/app/(auth)/auth";
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  getStreamIdsByChatId,
  saveChat,
  saveMessages,
} from "@/lib/db/queries";
import { generateUUID, getTrailingMessageId } from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { createDocument } from "@/lib/ai/tools/create-document";
import { updateDocument } from "@/lib/ai/tools/update-document";
import { requestSuggestions } from "@/lib/ai/tools/request-suggestions";
import { getWeather } from "@/lib/ai/tools/get-weather";
import { isProductionEnvironment } from "@/lib/constants";
import { myProvider } from "@/lib/ai/providers";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import { postRequestBodySchema, type PostRequestBody } from "./schema";
import { geolocation } from "@vercel/functions";
import {
  createResumableStreamContext,
  type ResumableStreamContext,
} from "resumable-stream";
import { after } from "next/server";
import type { Chat } from "@/lib/db/schema";
import { differenceInSeconds } from "date-fns";
import { ChatSDKError } from "@/lib/errors";

export const maxDuration = 60;

let globalStreamContext: ResumableStreamContext | null = null;

function getStreamContext() {
  if (!globalStreamContext) {
    try {
      globalStreamContext = createResumableStreamContext({
        waitUntil: after,
      });
    } catch (error: any) {
      if (error.message.includes("REDIS_URL")) {
        console.log(
          " > Resumable streams are disabled due to missing REDIS_URL"
        );
      } else {
        console.error(error);
      }
    }
  }

  return globalStreamContext;
}

export async function POST(request: Request) {
  console.log("[DEBUG] POST request received at /api/chat");

  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
    console.log("[DEBUG] Request body parsed");
  } catch (_) {
    console.error("[DEBUG] Error parsing request body:", _);
    return new ChatSDKError("bad_request:api").toResponse();
  }

  try {
    const { id, message, selectedChatModel, selectedVisibilityType, data } =
      requestBody;

    console.log("[DEBUG] Extracted values:", {
      id,
      messageContent: message.content,
      selectedChatModel,
      selectedVisibilityType,
      data,
    });

    const session = await auth();
    console.log(
      "[DEBUG] Session obtained:",
      session ? "Valid session" : "No session"
    );

    if (!session?.user) {
      console.log("[DEBUG] No user session, returning unauthorized");
      return new ChatSDKError("unauthorized:chat").toResponse();
    }

    const userType: UserType = session.user.type;

    const messageCount = await getMessageCountByUserId({
      id: session.user.id,
      differenceInHours: 24,
    });

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
      return new ChatSDKError("rate_limit:chat").toResponse();
    }

    const chat = await getChatById({ id });

    if (!chat) {
      const title = await generateTitleFromUserMessage({
        message,
      });

      await saveChat({
        id,
        userId: session.user.id,
        title,
        visibility: selectedVisibilityType,
      });
    } else {
      if (chat.userId !== session.user.id) {
        return new ChatSDKError("forbidden:chat").toResponse();
      }
    }

    const previousMessages = await getMessagesByChatId({ id });
    console.log("[DEBUG] Previous messages count:", previousMessages.length);

    const messages = appendClientMessage({
      // @ts-expect-error: todo add type conversion from DBMessage[] to UIMessage[]
      messages: previousMessages,
      message,
    });
    console.log("[DEBUG] Total messages for LLM:", messages.length);
    console.log("[DEBUG] Last message:", messages[messages.length - 1]);

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
    };

    // Check if this message contains TurboForge operation data
    let enhancedSystemPrompt = systemPrompt({
      selectedChatModel,
      requestHints,
    });

    if (data?.turboforgeOperation) {
      console.log(
        "[DEBUG] TurboForge operation data detected:",
        data.turboforgeOperation.type
      );

      if (data.turboforgeOperation.type === "research") {
        enhancedSystemPrompt += `

IMPORTANT: The user has just completed a research operation. Here are the complete research results:

${JSON.stringify(data.turboforgeOperation.fullResults, null, 2)}

Please analyze these research results and design a complete TurboForge process based on the findings. Use the research data to inform your process design with industry standards and best practices.`;
      } else if (data.turboforgeOperation.type === "implement") {
        enhancedSystemPrompt += `

IMPORTANT: A TurboForge process implementation has just completed. Here are the complete implementation results:

${JSON.stringify(data.turboforgeOperation.fullResults, null, 2)}

Please provide a comprehensive summary of what was created, including links and next steps for the user.`;
      }
    }

    await saveMessages({
      messages: [
        {
          chatId: id,
          id: message.id,
          role: "user",
          parts: message.parts,
          attachments: message.experimental_attachments ?? [],
          createdAt: new Date(),
        },
      ],
    });
    console.log("[DEBUG] User message saved to database");

    const streamId = generateUUID();
    await createStreamId({ streamId, chatId: id });
    console.log("[DEBUG] Stream ID created:", streamId);

    const stream = createDataStream({
      execute: (dataStream) => {
        console.log(
          "[DEBUG] Starting streamText execution",
          myProvider.languageModel(selectedChatModel)
        );
        //console.log('[DEBUG] System prompt:', systemPrompt({ selectedChatModel, requestHints }));

        const result = streamText({
          model: myProvider.languageModel(selectedChatModel),
          // Use enhanced system prompt that includes TurboForge data
          system: enhancedSystemPrompt,
          messages,
          maxSteps: 5, // Keep at 1 for Ollama
          experimental_activeTools: [], // Keep disabled for Ollama
          experimental_transform: smoothStream({ chunking: "word" }),
          experimental_generateMessageId: generateUUID,
          tools: {}, // Keep empty for Ollama
          onFinish: async ({ response }) => {
            console.log("[DEBUG] StreamText onFinish called");
            console.log(
              "[DEBUG] Response messages count:",
              response.messages.length
            );

            if (session.user?.id) {
              try {
                const assistantId = getTrailingMessageId({
                  messages: response.messages.filter(
                    (message) => message.role === "assistant"
                  ),
                });

                if (!assistantId) {
                  console.error(
                    "[DEBUG] No assistant message ID found",
                    JSON.stringify(response, null, 2)
                  );
                  throw new Error("No assistant message found!");
                }

                const [, assistantMessage] = appendResponseMessages({
                  messages: [message],
                  responseMessages: response.messages,
                });

                await saveMessages({
                  messages: [
                    {
                      id: assistantId,
                      chatId: id,
                      role: assistantMessage.role,
                      parts: assistantMessage.parts,
                      attachments:
                        assistantMessage.experimental_attachments ?? [],
                      createdAt: new Date(),
                    },
                  ],
                });
                console.log("[DEBUG] Assistant message saved to database");
              } catch (_) {
                console.error("[DEBUG] Error saving assistant message:", _);
                console.error("Failed to save chat");
              }
            }
          },
          experimental_telemetry: {
            isEnabled: isProductionEnvironment,
            functionId: "stream-text",
          },
        });

        console.log("[DEBUG] StreamText result created, consuming stream");

        result.consumeStream();

        result.mergeIntoDataStream(dataStream, {
          sendReasoning: true,
        });

        console.log("[DEBUG] Stream merged into data stream");
      },
      onError: (error) => {
        console.error("[DEBUG] DataStream onError called:", error);
        return "Oops, an error occurred!";
      },
    });

    const streamContext = getStreamContext();

    if (streamContext) {
      console.log("[DEBUG] Returning stream response");
      return new Response(
        await streamContext.resumableStream(streamId, () => stream)
      );
    } else {
      console.log("[DEBUG] Returning stream response");
      return new Response(stream);
    }
  } catch (error) {
    console.error("[DEBUG] Unhandled error in POST:", error);
    console.error(
      "[DEBUG] Request body was:",
      JSON.stringify(requestBody, null, 2)
    );

    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }
  }
}

export async function GET(request: Request) {
  const streamContext = getStreamContext();
  const resumeRequestedAt = new Date();

  if (!streamContext) {
    return new Response(null, { status: 204 });
  }

  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chatId");

  if (!chatId) {
    return new ChatSDKError("bad_request:api").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  let chat: Chat;

  try {
    chat = await getChatById({ id: chatId });
  } catch {
    return new ChatSDKError("not_found:chat").toResponse();
  }

  if (!chat) {
    return new ChatSDKError("not_found:chat").toResponse();
  }

  if (chat.visibility === "private" && chat.userId !== session.user.id) {
    return new ChatSDKError("forbidden:chat").toResponse();
  }

  const streamIds = await getStreamIdsByChatId({ chatId });

  if (!streamIds.length) {
    return new ChatSDKError("not_found:stream").toResponse();
  }

  const recentStreamId = streamIds.at(-1);

  if (!recentStreamId) {
    return new ChatSDKError("not_found:stream").toResponse();
  }

  const emptyDataStream = createDataStream({
    execute: () => {},
  });

  const stream = await streamContext.resumableStream(
    recentStreamId,
    () => emptyDataStream
  );

  /*
   * For when the generation is streaming during SSR
   * but the resumable stream has concluded at this point.
   */
  if (!stream) {
    const messages = await getMessagesByChatId({ id: chatId });
    const mostRecentMessage = messages.at(-1);

    if (!mostRecentMessage) {
      return new Response(emptyDataStream, { status: 200 });
    }

    if (mostRecentMessage.role !== "assistant") {
      return new Response(emptyDataStream, { status: 200 });
    }

    const messageCreatedAt = new Date(mostRecentMessage.createdAt);

    if (differenceInSeconds(resumeRequestedAt, messageCreatedAt) > 15) {
      return new Response(emptyDataStream, { status: 200 });
    }

    const restoredStream = createDataStream({
      execute: (buffer) => {
        buffer.writeData({
          type: "append-message",
          message: JSON.stringify(mostRecentMessage),
        });
      },
    });

    return new Response(restoredStream, { status: 200 });
  }

  return new Response(stream, { status: 200 });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatSDKError("bad_request:api").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  const chat = await getChatById({ id });

  if (chat.userId !== session.user.id) {
    return new ChatSDKError("forbidden:chat").toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
