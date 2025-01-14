import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import { ChatOpenAI } from "@langchain/openai";
import { StateGraph, MessagesAnnotation } from "@langchain/langgraph"; 
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage } from "@langchain/core/messages";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { HumanMessage } from "@langchain/core/messages";
import fs from "fs"; 

import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

const GraphState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
  }),
});

const tavilyApi = process.env.tavilyApi;
const OPENAPI_KEY = process.env.OPENAPI_KEY;

export const factCheckerParagraphv2 = async (raw: string) => {
  const tools = [new TavilySearchResults({maxResults: 3, apiKey: tavilyApi})];
  const toolNode = new ToolNode<typeof GraphState.State>(tools);
  
  const model = new ChatOpenAI({
    model: "gpt-4o-mini",
    temperature: 0,
    apiKey: OPENAPI_KEY,
  });
  
  const responseTool = z.object({
    validity: z.enum(["true", "false", "unknown"]).describe("The validity of the statement."), 
    fallacies: z.string().describe("A comma separated list of fallacies found in the statement."),
    reason: z.string().describe("The reason why the statement is true or false."),
    sources: z.array(z.string()).describe("A list of URL sources that support the validity of the statement."),
  });
  const finalResponseTool = tool(async () => "", {
    name: "Response",
    description: "Always repspond to the user using this tool.",
    schema: responseTool,
  }); 
  
  const boundModel = model.bindTools([
    ...tools,
    finalResponseTool,
  ]);  
  
  const shouldContinue = ({messages}: typeof MessagesAnnotation.State) => {
    const lastMessage = messages[messages.length - 1] as AIMessage;  
    if (!lastMessage.tool_calls || lastMessage.tool_calls.length === 0) {
      return "__end__";
    }
    if (lastMessage.tool_calls[0].name === "Response") {
      return "__end__";
    }
    return "tools";
  };
  
  const  callModel = async (state: typeof GraphState.State,) => {
    const response = await boundModel.invoke(state.messages); 
    return { 
      messages: [response]
    };
  };
  
  const workflow = new StateGraph(GraphState)
    .addNode("agent", callModel)
    .addNode("tools", toolNode)
    .addEdge("__start__", "agent")
    .addConditionalEdges( 
      "agent", 
      shouldContinue, 
      {
        __end__: "__end__",
        tools: "tools",
      }
    ) 
    .addEdge("tools", "agent");
  
  const app = workflow.compile();  

  const graph = await app.getGraphAsync();
  const image = await graph.drawMermaidPng();
  const arrayBuffer = await image.arrayBuffer();     
  
  fs.writeFileSync("graph.png", Buffer.from(arrayBuffer));

  const finalState = await app.invoke({
    messages: [new HumanMessage(
      `Fact-check this statement: "${raw}"`
    )]
  });
  
  console.log((finalState.messages[finalState.messages.length - 1] as AIMessage).tool_calls?.[0].args);

  const res = (finalState.messages[finalState.messages.length - 1] as AIMessage).tool_calls?.[0].args;
  if(res) { 
    return res;
  } else {
    throw new Error("Failed to fact check the statement");
  }
};
  

(async () => {
    await factCheckerParagraphv2("The earth is flat");
})();

