"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.factCheckerParagraphv2 = void 0;
const tavily_search_1 = require("@langchain/community/tools/tavily_search");
const openai_1 = require("@langchain/openai");
const langgraph_1 = require("@langchain/langgraph");
const prebuilt_1 = require("@langchain/langgraph/prebuilt");
const zod_1 = require("zod");
const tools_1 = require("@langchain/core/tools");
const messages_1 = require("@langchain/core/messages");
const fs_1 = __importDefault(require("fs"));
const langgraph_2 = require("@langchain/langgraph");
const GraphState = langgraph_2.Annotation.Root({
    messages: (0, langgraph_2.Annotation)({
        reducer: langgraph_2.messagesStateReducer,
    }),
});
const tavilyApi = process.env.tavilyApi;
const OPENAPI_KEY = process.env.OPENAPI_KEY;
const factCheckerParagraphv2 = (raw) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const tools = [new tavily_search_1.TavilySearchResults({ maxResults: 3, apiKey: tavilyApi })];
    const toolNode = new prebuilt_1.ToolNode(tools);
    const model = new openai_1.ChatOpenAI({
        model: "gpt-4o-mini",
        temperature: 0,
        apiKey: OPENAPI_KEY,
    });
    const responseTool = zod_1.z.object({
        validity: zod_1.z.enum(["true", "false", "unknown"]).describe("The validity of the statement."),
        fallacies: zod_1.z.string().describe("A comma separated list of fallacies found in the statement."),
        reason: zod_1.z.string().describe("The reason why the statement is true or false."),
        sources: zod_1.z.array(zod_1.z.string()).describe("A list of URL sources that support the validity of the statement."),
    });
    const finalResponseTool = (0, tools_1.tool)(() => __awaiter(void 0, void 0, void 0, function* () { return ""; }), {
        name: "Response",
        description: "Always repspond to the user using this tool.",
        schema: responseTool,
    });
    const boundModel = model.bindTools([
        ...tools,
        finalResponseTool,
    ]);
    const shouldContinue = ({ messages }) => {
        const lastMessage = messages[messages.length - 1];
        if (!lastMessage.tool_calls || lastMessage.tool_calls.length === 0) {
            return "__end__";
        }
        if (lastMessage.tool_calls[0].name === "Response") {
            return "__end__";
        }
        return "tools";
    };
    const callModel = (state) => __awaiter(void 0, void 0, void 0, function* () {
        const response = yield boundModel.invoke(state.messages);
        return {
            messages: [response]
        };
    });
    const workflow = new langgraph_1.StateGraph(GraphState)
        .addNode("agent", callModel)
        .addNode("tools", toolNode)
        .addEdge("__start__", "agent")
        .addConditionalEdges("agent", shouldContinue, {
        __end__: "__end__",
        tools: "tools",
    })
        .addEdge("tools", "agent");
    const app = workflow.compile();
    const graph = yield app.getGraphAsync();
    const image = yield graph.drawMermaidPng();
    const arrayBuffer = yield image.arrayBuffer();
    fs_1.default.writeFileSync("graph.png", Buffer.from(arrayBuffer));
    const finalState = yield app.invoke({
        messages: [new messages_1.HumanMessage(`Fact-check this statement: "${raw}"`)]
    });
    console.log((_a = finalState.messages[finalState.messages.length - 1].tool_calls) === null || _a === void 0 ? void 0 : _a[0].args);
    const res = (_b = finalState.messages[finalState.messages.length - 1].tool_calls) === null || _b === void 0 ? void 0 : _b[0].args;
    if (res) {
        return res;
    }
    else {
        throw new Error("Failed to fact check the statement");
    }
});
exports.factCheckerParagraphv2 = factCheckerParagraphv2;
(() => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, exports.factCheckerParagraphv2)("The earth is flat");
}))();
