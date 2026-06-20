// Agents are not allowed to import write-tool packages directly.
// All external actions must go through BaseAgent.createApproval() →
// action-execution-worker.ts → runWithDispatchContext().
// The runtime check (requireDispatchContext) is the hard gate; this is the
// early-warning signal that catches the bypass at lint time.

import tseslint from "typescript-eslint";

export default tseslint.config({
  files: ["**/*.ts"],
  ignores: ["base/**"],
  extends: [tseslint.configs.base],
  rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@mammoth/tool-email*"],
              message:
                "Agents cannot call sendEmail() directly. Use BaseAgent.createApproval() with actionType 'send_outreach_sequence' instead.",
            },
            {
              group: ["@mammoth/tool-linkedin*"],
              message:
                "Agents cannot call postToLinkedIn() directly. Use BaseAgent.createApproval() with actionType 'post_linkedin' instead.",
            },
            {
              group: ["@mammoth/tool-twitter*"],
              message:
                "Agents cannot call postTweet() directly. Use BaseAgent.createApproval() with actionType 'post_twitter' instead.",
            },
            {
              group: ["@mammoth/tool-slack*"],
              message:
                "Agents cannot call sendApprovalToSlack() directly. Use BaseAgent.createApproval() which routes through the action-execution-worker.",
            },
            {
              group: ["@mammoth/tool-vapi*"],
              message:
                "Agents cannot call initiateVapiCall() directly. Use BaseAgent.createApproval() with actionType 'initiate_voice_call' (Ring 3) instead.",
            },
          ],
        },
      ],
  },
});
