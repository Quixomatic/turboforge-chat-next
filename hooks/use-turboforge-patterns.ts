// hooks/use-turboforge-patterns.ts
import { useEffect, useState, useRef } from "react";
import type { UIMessage } from "ai";
import type { UseChatHelpers } from "@ai-sdk/react";

export interface TurboForgeOperation {
  type: "research" | "implement";
  operationId?: string;
  status:
    | "detecting"
    | "starting"
    | "polling"
    | "processing"
    | "completed"
    | "failed";
  statusMessage: string;
  data?: any;
}

// Pattern definitions
const RESEARCH_PATTERN = /\[RESEARCH_REQUEST:([^:]+):([^\]]+)\]/;
const IMPLEMENT_PATTERN = /\[IMPLEMENT_PROCESS:(.*?)\]/s;

export function useTurboForgePatterns({
  messages,
  setMessages,
  status,
  append,
}: {
  messages: UIMessage[];
  setMessages: UseChatHelpers["setMessages"];
  status: UseChatHelpers["status"];
  append: UseChatHelpers["append"];
}) {
  const [operation, setOperation] = useState<TurboForgeOperation | null>(null);
  const pollingInterval = useRef<NodeJS.Timeout>();
  const lastProcessedMessageId = useRef<string>();

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current);
      }
    };
  }, []);

  // Check for patterns in the latest assistant message
  useEffect(() => {
    if ((status !== "streaming" && status !== "ready") || !messages.length)
      return;

    const lastMessage = messages[messages.length - 1];
    if (
      lastMessage.role !== "assistant" ||
      lastMessage.id === lastProcessedMessageId.current
    ) {
      return;
    }

    const textPart = lastMessage.parts?.find((part) => part.type === "text");
    const content = textPart && "text" in textPart ? textPart.text : "";

    // Check for research pattern
    const researchMatch = content.match(RESEARCH_PATTERN);
    if (researchMatch) {
      const [, processType, industry] = researchMatch;
      lastProcessedMessageId.current = lastMessage.id;

      setOperation({
        type: "research",
        status: "starting",
        statusMessage: "Initiating research request...",
        data: { processType, industry },
      });

      startResearchOperation(processType, industry);
      return;
    }

    // Check for implementation pattern
    const implementMatch = content.match(IMPLEMENT_PATTERN);
    if (implementMatch) {
      try {
        const processDefinition = JSON.parse(implementMatch[1]);
        lastProcessedMessageId.current = lastMessage.id;

        setOperation({
          type: "implement",
          status: "starting",
          statusMessage: "Preparing implementation...",
          data: { processDefinition },
        });

        startImplementationOperation(processDefinition);
      } catch (error) {
        console.error("Failed to parse implementation JSON:", error);
      }
      return;
    }
  }, [messages, status]);

  const startResearchOperation = async (
    processType: string,
    industry: string
  ) => {
    try {
      setOperation((prev) =>
        prev
          ? {
              ...prev,
              status: "starting",
              statusMessage: "Starting research...",
            }
          : null
      );

      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          processType: processType.trim(),
          industry: industry.trim(),
        }),
      });

      if (!response.ok) throw new Error("Research request failed");

      const { operation_id } = await response.json();

      setOperation((prev) =>
        prev
          ? {
              ...prev,
              operationId: operation_id,
              status: "polling",
              statusMessage: "Researching industry standards...",
            }
          : null
      );

      startPolling(operation_id, "research");
    } catch (error) {
      console.error("Research operation failed:", error);
      setOperation((prev) =>
        prev
          ? {
              ...prev,
              status: "failed",
              statusMessage: "Research failed. Please try again.",
            }
          : null
      );
    }
  };

  const startImplementationOperation = async (processDefinition: any) => {
    try {
      setOperation((prev) =>
        prev
          ? {
              ...prev,
              status: "starting",
              statusMessage: "Starting implementation...",
            }
          : null
      );

      const response = await fetch("/api/implement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(processDefinition),
      });

      if (!response.ok) throw new Error("Implementation request failed");

      const { operation_id } = await response.json();

      setOperation((prev) =>
        prev
          ? {
              ...prev,
              operationId: operation_id,
              status: "polling",
              statusMessage: "Implementing process in ServiceNow...",
            }
          : null
      );

      startPolling(operation_id, "implement");
    } catch (error) {
      console.error("Implementation operation failed:", error);
      setOperation((prev) =>
        prev
          ? {
              ...prev,
              status: "failed",
              statusMessage: "Implementation failed. Please try again.",
            }
          : null
      );
    }
  };

  const startPolling = (
    operationId: string,
    type: "research" | "implement"
  ) => {
    const statusMessages = {
      research: [
        "Researching industry standards...",
        "Analyzing regulatory requirements...",
        "Processing research results...",
        "Compiling findings...",
      ],
      implement: [
        "Creating process structure...",
        "Setting up milestones and steps...",
        "Configuring validation rules...",
        "Finalizing implementation...",
      ],
    };

    let messageIndex = 0;
    const messages = statusMessages[type];

    // Update status message every 3 seconds
    const messageInterval = setInterval(() => {
      messageIndex = (messageIndex + 1) % messages.length;
      setOperation((prev) =>
        prev
          ? {
              ...prev,
              statusMessage: messages[messageIndex],
            }
          : null
      );
    }, 3000);

    // Poll for completion
    pollingInterval.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/status/${operationId}`);
        if (!response.ok) throw new Error("Status check failed");

        const result = await response.json();

        if (result.status === "completed") {
          clearInterval(pollingInterval.current!);
          clearInterval(messageInterval);

          setOperation((prev) =>
            prev
              ? {
                  ...prev,
                  status: "processing",
                  statusMessage:
                    type === "research"
                      ? "Processing research results..."
                      : "Completing implementation...",
                }
              : null
          );

          // Send results back to AI
          await sendResultsToAI(result, type);
        } else if (result.status === "failed") {
          clearInterval(pollingInterval.current!);
          clearInterval(messageInterval);

          setOperation((prev) =>
            prev
              ? {
                  ...prev,
                  status: "failed",
                  statusMessage: `${
                    type === "research" ? "Research" : "Implementation"
                  } failed. Please try again.`,
                }
              : null
          );
        }
      } catch (error) {
        console.error("Polling error:", error);
        clearInterval(pollingInterval.current!);
        clearInterval(messageInterval);

        setOperation((prev) =>
          prev
            ? {
                ...prev,
                status: "failed",
                statusMessage: "Operation failed. Please try again.",
              }
            : null
        );
      }
    }, 2000);
  };

  const sendResultsToAI = async (
    result: any,
    type: "research" | "implement"
  ) => {
    try {
      let displayMessage: string;
      let fullMessage: string;

      if (type === "research") {
        // Show clean summary to user
        const researchData = result.result?.researchData;
        const summary = {
          processType: researchData?.processType,
          industry: researchData?.industry,
          resultCount: researchData?.searchResults?.length || 0,
        };
        displayMessage = `Research completed successfully. Found ${summary.resultCount} relevant sources for ${summary.processType} in ${summary.industry}. Please design a complete TurboForge process based on the research findings.`;

        // Full message with hidden data for AI
        fullMessage = `${displayMessage}

[HIDDEN_RESEARCH_DATA]
${JSON.stringify(result.result, null, 2)}
[/HIDDEN_RESEARCH_DATA]`;
      } else {
        // Show clean summary to user
        const implementData = result.result;
        const summary = {
          processName: implementData?.processName,
          processId: implementData?.processId,
          links: implementData?.links,
        };
        displayMessage = `Implementation completed successfully! Created "${
          summary.processName
        }" with ID: ${summary.processId}. 

Admin URL: ${summary.links?.admin || "Not available"}
User URL: ${summary.links?.user || "Not available"}

Please provide a summary of what was created and any next steps.`;

        // Full message with hidden data for AI
        fullMessage = `${displayMessage}

[HIDDEN_IMPLEMENTATION_DATA]
${JSON.stringify(result.result, null, 2)}
[/HIDDEN_IMPLEMENTATION_DATA]`;
      }

      setOperation((prev) =>
        prev
          ? {
              ...prev,
              status: "processing",
              statusMessage: "Processing results...",
            }
          : null
      );

      // Send the full message (AI gets everything, we'll handle display separately)
      await append({
        role: "user",
        content: fullMessage,
      });

      // Clear operation after sending
      setTimeout(() => {
        setOperation(null);
      }, 1000);
    } catch (error) {
      console.error("Failed to send results to AI:", error);
      setOperation((prev) =>
        prev
          ? {
              ...prev,
              status: "failed",
              statusMessage: "Failed to process results. Please try again.",
            }
          : null
      );
    }
  };

  return {
    operation,
    isProcessing: operation !== null && operation.status !== "completed",
  };
}
