"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNowPlaying } from "react-nowplaying";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mic, MicOff, Loader2, MessageSquare } from "lucide-react";
import { GitHubLogoIcon } from "@radix-ui/react-icons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TextConversation } from "@/components/Chat";

import {
  LiveConnectionState,
  LiveTranscriptionEvent,
  LiveTranscriptionEvents,
  useDeepgram,
} from "@/context/DeepgramContextProvider";
import {
  MicrophoneEvents,
  MicrophoneState,
  useMicrophone,
} from "@/context/MicrophoneContextProvider";
import TranscriptionBubble from "./TranscriptBubble";
import ChatHistory, { ConversationMessage } from "./Conversation";
import { FileUpload } from "./FileUpload";
import { getCurrentTimeStamp } from "@/lib/utils";

import { useToast } from "@/hooks/use-toast";

enum UserType {
  Human = "Human",
  Bot = "Bot",
}

enum ProcessingState {
  NOT_INITIATED = "not-initiated",
  PROCESSING = "processing",
  PROCESSED = "processed",
}

const App: React.FC = () => {
  const [caption, setCaption] = useState<string | undefined>(
    "Click to begin and start speaking"
  );

  const [user, setUser] = useState<UserType>(UserType.Human);
  const [llmText, setLLMText] = useState<string>("");
  const [isGeneratingResponse, setIsGeneratingResponse] =
    useState<boolean>(false);
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);

  const { player, stop: stopAudio, play: playAudio } = useNowPlaying();

  const [uploadedFile, setUploadedFile] = React.useState<File | null>(null);
  const [fileSubmitted, setFileSubmitted] = React.useState<boolean>(false);

  const [namespace, setNamespace] = useState<string>("default");

  const fullTranscriptRef = useRef<string>("");

  const { toast } = useToast();

  const { connection, connectToDeepgram, connectionState } = useDeepgram();
  const {
    setupMicrophone,
    microphone,
    startMicrophone,
    stopMicrophone,
    microphoneState,
  } = useMicrophone();

  const captionTimeout = useRef<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const keepAliveInterval = useRef<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any

  const [processingState, setProcessingState] = useState<ProcessingState>(
    ProcessingState.NOT_INITIATED
  );

  const getTTS = async (text: string) => {
    stopAudio();

    const response = await fetch("/api/speak", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
      cache: "no-store",
    });
    stopAudio();

    const audioBlob = await response.blob();

    await playAudio(audioBlob, "audio/mp3");

    setLLMText(text);
    setIsGeneratingResponse(false);

    await new Promise<void>((resolve) => {
      player!.onended = () => resolve();
    });
  };

  const toggleCall = () => {
    if (microphoneState === MicrophoneState.Paused) {
      startMicrophone();
    } else if (microphoneState === MicrophoneState.Open) {
      stopMicrophone();
    } else setupMicrophone();
  };

  const handleFileUpload = (file: File) => {
    setUploadedFile(file);
    console.log("File received:", file.name);
  };

  const handleSubmit = async () => {
    if (!uploadedFile) {
      console.log("No file uploaded");

      toast({
        variant: "destructive",
        title: "Uh oh! Something went wrong.",
        description: "Please select a file to upload.",
      });

      return;
    }

    setFileSubmitted(true);

    toast({
      description: "File submitted successfully",
    });

    setNamespace(uploadedFile.name);
    // setNamespace("new_namespace");

    console.log("File uploaded successfully");
  };

  useEffect(() => {
    // send the file for processing
    const sendFileForProcessing = async () => {
      if (!uploadedFile) {
        throw Error("No file uploaded");
      }

      setProcessingState(ProcessingState.PROCESSING);

      const formData = new FormData();
      formData.append("file", uploadedFile);
      formData.append("namespace", namespace);

      try {
        await fetch("/api/process_doc", {
          method: "POST",
          body: formData,
          cache: "no-store",
        });

        toast({
          description: "File processed successfully",
        });

        setProcessingState(ProcessingState.PROCESSED);
      } catch (error) {
        console.log(error);
        toast({
          variant: "destructive",
          title: "Error processing document",
          description: "Please try again.",
        });
        setProcessingState(ProcessingState.NOT_INITIATED);
      }
    };

    if (fileSubmitted) sendFileForProcessing();
  }, [fileSubmitted]);

  // if microphone is ready connect to deepgram
  useEffect(() => {
    if (microphoneState === MicrophoneState.Ready) {
      connectToDeepgram({
        model: "nova-2",
        interim_results: true,
        smart_format: true,
        filler_words: true,
        utterance_end_ms: 3000,
        endpointing: 300,
        sample_rate: 16000,
      });
    }
  }, [microphoneState]);

  useEffect(() => {
    if (!microphone || !connection) return;

    const onData = (e: BlobEvent) => {
      if (e.data.size > 0) {
        connection?.send(e.data);
      }
    };

    const onTranscript = (data: LiveTranscriptionEvent) => {
      const { is_final: isFinal, speech_final: speechFinal } = data;

      const thisCaption = data.channel.alternatives[0].transcript;

      const startTime = data.start;
      const duration = data.duration;

      console.log(
        `${startTime} - ${
          startTime + duration
        } is_final: ${isFinal}, speech_final: ${speechFinal}: caption: ${thisCaption}`
      );

      if (thisCaption !== "") {
        setCaption(thisCaption);
      }

      if (isFinal) {
        fullTranscriptRef.current += " " + thisCaption;
      }

      if (isFinal && speechFinal && fullTranscriptRef.current.trim() !== "") {
        console.log("Full Transcript:", fullTranscriptRef.current.trim());

        // Append human message to conversation
        setConversation((prev) => [
          ...prev,
          {
            role: "user",
            content: fullTranscriptRef.current.trim(),
            timestamp: getCurrentTimeStamp(),
          },
        ]);

        stopMicrophone();

        clearTimeout(captionTimeout.current);
        setCaption(undefined);
        // captionTimeout.current = setTimeout(() => {
        //   setCaption(undefined);
        //   clearTimeout(captionTimeout.current);
        // }, 3000);
      }
    };

    if (connectionState === LiveConnectionState.OPEN) {
      connection.addListener(LiveTranscriptionEvents.Transcript, onTranscript);
      microphone.addEventListener(MicrophoneEvents.DataAvailable, onData);

      startMicrophone();
    }
    return () => {
      // prettier-ignore
      connection.removeListener(LiveTranscriptionEvents.Transcript, onTranscript);
      microphone.removeEventListener(MicrophoneEvents.DataAvailable, onData);
      clearTimeout(captionTimeout.current);
    };
  }, [connectionState]);

  useEffect(() => {
    const getLLMResponse = async (
      conv: ConversationMessage[]
    ): Promise<void> => {
      setIsGeneratingResponse(true);
      setLLMText("Thinking...");

      const response = await fetch("/api/llm_response", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: fullTranscriptRef.current.trim(),
          full_conv: conv,
          namespace,
        }),
        cache: "no-store",
      });
      const result = await response.json();

      console.log("result.llm_response", result.llm_response);

      // BOT will speak the response
      setUser(UserType.Bot);
      await getTTS(result.llm_response);

      // Append bot response to conversation
      setConversation((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.llm_response,
          timestamp: getCurrentTimeStamp(),
        },
      ]);

      // Reset back to human
      setUser(UserType.Human);
      fullTranscriptRef.current = "";
      startMicrophone();
    };

    if (
      microphoneState === MicrophoneState.Paused &&
      fullTranscriptRef.current.trim() !== ""
    ) {
      const tempConv: ConversationMessage[] = [
        ...conversation,
        {
          role: "user",
          content: fullTranscriptRef.current.trim(),
          timestamp: getCurrentTimeStamp(),
        },
      ];

      getLLMResponse(tempConv);
    }
  }, [microphoneState]);

  useEffect(() => {
    if (!connection) return;

    if (
      microphoneState !== MicrophoneState.Open &&
      connectionState === LiveConnectionState.OPEN
    ) {
      connection.keepAlive();

      keepAliveInterval.current = setInterval(() => {
        connection.keepAlive();
      }, 10000);
    } else {
      clearInterval(keepAliveInterval.current);
    }

    return () => {
      clearInterval(keepAliveInterval.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [microphoneState, connectionState]);

  const micPulseAnimation = {
    scale: [1, 1.2, 1],
    opacity: [1, 0.8, 1],
    transition: { duration: 0.8, repeat: Infinity },
  };

  return (
    <div className="container max-w-screen-xl mx-auto px-4 flex flex-col items-center justify-center rounded min-h-screen">
      <div className="absolute top-4 right-4">
        <a
          href="https://github.com/sid-gandhi/rag-voice-ai"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background hover:opacity-80"
        >
          <GitHubLogoIcon className="h-6 w-6" />
        </a>
      </div>
      {!fileSubmitted ? (
        <div className="container mx-auto p-4 mt-4">
          <h1 className="text-xl font-bold mb-4 text-center">
            Upload your document
          </h1>
          <FileUpload onFileUpload={handleFileUpload} />
          {uploadedFile && (
            <div className="mt-4 text-center">
              <p>File ready to upload: {uploadedFile.name}</p>
              <Button onClick={handleSubmit} className="mt-2 ">
                Submit File
              </Button>
            </div>
          )}
        </div>
      ) : processingState === ProcessingState.PROCESSING ? (
        <div className="flex flex-col items-center justify-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-lg">
            Document is processing, please wait a few seconds...
          </p>
        </div>
      ) : (
        <div className="container mx-auto p-4">
          <Tabs defaultValue="voice" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger
                value="voice"
                className="flex items-center justify-center"
              >
                <Mic className="mr-2 h-4 w-4" />
                Voice
              </TabsTrigger>
              <TabsTrigger
                value="text"
                className="flex items-center justify-center"
              >
                <MessageSquare className="mr-2 h-4 w-4" />
                Chat
              </TabsTrigger>
            </TabsList>
            <TabsContent value="voice">
              <div className="flex flex-col items-center justify-center space-y-4">
                {uploadedFile?.name && (
                  <Badge variant="secondary">{uploadedFile?.name}</Badge>
                )}
                {conversation.length ? (
                  <ChatHistory messages={conversation} />
                ) : (
                  <></>
                )}
                {caption && <TranscriptionBubble text={caption} />}
                <motion.div className="mt-4">
                  {user === UserType.Human ? (
                    <Button
                      onClick={toggleCall}
                      className="flex items-center justify-center w-12 h-12 rounded-full shadow-lg"
                    >
                      <AnimatePresence>
                        <motion.div
                          key="mic-icon"
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={
                            microphoneState === MicrophoneState.Open ||
                            microphoneState === MicrophoneState.Opening
                              ? micPulseAnimation
                              : { opacity: 1, scale: 1 }
                          }
                          exit={{ opacity: 0, scale: 0.8 }}
                          transition={{ duration: 0.3 }}
                        >
                          {microphoneState === MicrophoneState.Open ||
                          microphoneState === MicrophoneState.Opening ? (
                            <Mic />
                          ) : (
                            <MicOff />
                          )}
                        </motion.div>
                      </AnimatePresence>
                    </Button>
                  ) : isGeneratingResponse ? (
                    <div className="flex flex-col items-center justify-center space-y-4">
                      <Loader2 className="h-8 w-8 animate-spin" />
                      <p className="text-lg">Thinking...</p>
                    </div>
                  ) : (
                    <TranscriptionBubble text={llmText} />
                  )}
                </motion.div>
              </div>
            </TabsContent>
            <TabsContent value="text">
              <TextConversation namespace={namespace} />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
};

export default App;
