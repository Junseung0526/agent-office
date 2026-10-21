/**
 * 에이전트 오피스 (Agent Office) - Claude Code 로그 이벤트 파서 (lib/parsers/claude.js)
 *
 * 메인 세션(<sessionId>.jsonl)과 서브에이전트 세션(<sessionId>/subagents/agent-<id>.jsonl)을
 * 동일한 파서로 처리하며, state.isSubagent 여부에 따라 agentId와 종료 이벤트를 분기한다.
 */

const { getRoomForTool } = require('../config');

const QUESTION_REGEX = /\?|할까요|인가요|어떠신가요|어떻게|선택|골라|확인해|의견|원하시나요|말씀해주세요|골라주세요/i;
const MAX_TOOL_ROOMS = 200;

// 도구 호출 ID -> 방 매핑 기록 (병렬 도구 호출 시 tool_end를 올바른 방으로 귀속)
function rememberToolRoom(state, toolUseId, room) {
  if (!toolUseId) return;
  if (!state.toolRooms) state.toolRooms = new Map();
  state.toolRooms.set(toolUseId, room);
  if (state.toolRooms.size > MAX_TOOL_ROOMS) {
    state.toolRooms.delete(state.toolRooms.keys().next().value);
  }
}

function takeToolRoom(state, toolUseId) {
  if (!toolUseId || !state.toolRooms || !state.toolRooms.has(toolUseId)) return null;
  const room = state.toolRooms.get(toolUseId);
  state.toolRooms.delete(toolUseId);
  return room;
}

function resultText(content) {
  if (typeof content === 'string') return stripImageRefs(content);
  if (Array.isArray(content)) {
    const text = stripImageRefs(content.filter(c => c && c.type === 'text' && c.text).map(c => c.text).join(' '));
    if (text) return text;
    if (content.some(c => c && c.type === 'image')) return '이미지 수신';
  }
  return '';
}

// 스크린샷 결과에 붙는 "[Image: source: /path]" 참조는 일지에 의미가 없으므로 제거
function stripImageRefs(text) {
  return text.replace(/\[Image[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
}

// 슬래시 명령·시스템 태그가 섞인 입력을 사람이 읽는 형태로 정리 ("/ponytail:ponytail full")
function cleanPrompt(text) {
  const cmd = text.match(/<command-name>([^<]*)<\/command-name>/);
  if (cmd) {
    const args = text.match(/<command-args>([^<]*)<\/command-args>/);
    return `${cmd[1].trim()} ${args ? args[1].trim() : ''}`.trim();
  }
  const stripped = text
    .replace(/<(system-reminder|task-notification|local-command-[a-z]+|command-message)>[\s\S]*?<\/\1>/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return stripped || '시스템 알림';
}

function extractQuestion(input) {
  if (!input) return null;
  if (Array.isArray(input.questions) && input.questions[0] && input.questions[0].question) {
    return input.questions[0].question;
  }
  return input.question || input.prompt || null;
}

function parseClaudeLine(line, state) {
  try {
    const obj = JSON.parse(line);
    const events = [];
    const now = Date.parse(obj.timestamp) || Date.now();
    const agentId = state.isSubagent ? `sub_${state.agentId}` : 'main';
    const base = {
      sessionId: state.isSubagent ? state.parentSessionId : state.sessionId,
      projectName: state.projectName,
      cwd: state.cwd,
      floor: state.floorNumber,
      agentType: 'claude',
      agentId,
      timestamp: now
    };
    const idPrefix = `claude_${state.sessionId}`;

    const subagentFinish = (summary) => ({
      ...base,
      id: `${idPrefix}_finish`,
      action: 'subagent_finish',
      room: 'elevator',
      subagentName: state.description || 'Subagent',
      subagentRole: state.agentType || '서브에이전트',
      resultSummary: (summary || '작업 완료 보고').slice(0, 150)
    });

    if (obj.type === 'user') {
      if (obj.isMeta) return events;
      const content = obj.message && obj.message.content;
      let prompt = typeof content === 'string' ? content : '사용자 질문';

      if (Array.isArray(content)) {
        const t = content.find(c => c.type === 'text');
        if (t && t.text) prompt = t.text;
        for (const c of content) {
          if (c.type !== 'tool_result') continue;
          const text = resultText(c.content);
          events.push({
            ...base,
            id: `${idPrefix}_${c.tool_use_id || now}_res`,
            toolUseId: c.tool_use_id || null,
            action: 'tool_end',
            room: takeToolRoom(state, c.tool_use_id) || state.currentRoom || 'dev',
            isError: Boolean(c.is_error),
            errorSummary: c.is_error ? (text.slice(0, 120) || '에러') : null,
            resultSummary: text.slice(0, 100) || '결과 수신'
          });
        }
        // SubagentHandback 등 턴을 끝내는 도구 결과는 서브에이전트 퇴근 신호
        if (state.isSubagent && obj.toolEndsTurn) {
          events.push(subagentFinish(null));
        }
      }

      // 서브에이전트의 프롬프트 입력은 사용자 입력이 아니므로 무시
      if (events.length === 0 && !state.isSubagent) {
        events.push({
          ...base,
          id: `${idPrefix}_${obj.uuid || now}_user`,
          action: 'user_input',
          room: 'user_desk',
          userPrompt: cleanPrompt(prompt).slice(0, 150)
        });
      }
      return events;
    }

    if (obj.type === 'assistant' && obj.message) {
      const msg = obj.message;
      if (Array.isArray(msg.content)) {
        for (let i = 0; i < msg.content.length; i++) {
          const item = msg.content[i];
          if (item.type === 'thinking' && item.thinking && item.thinking.trim()) {
            events.push({
              ...base,
              id: `${idPrefix}_${obj.uuid || now}_think_${i}`,
              action: 'thinking',
              room: 'meeting',
              thinkingText: item.thinking.trim()
            });
          } else if (item.type === 'tool_use') {
            const toolName = item.name;
            const input = item.input || {};
            const room = getRoomForTool(toolName);
            state.currentRoom = room;
            rememberToolRoom(state, item.id, room);

            const question = (toolName === 'AskUserQuestion') ? extractQuestion(input) : null;
            if (toolName === 'AskUserQuestion') {
              events.push({
                ...base,
                id: `${idPrefix}_${item.id || i}_ask`,
                toolUseId: item.id || null,
                action: 'ask_user',
                room: 'user_desk',
                questionText: (question || '사용자에게 질문').slice(0, 150)
              });
            } else {
              // Agent/Task 호출은 엘리베이터에서 팀원 호출(tool_start)로 표현하고,
              // 실제 서브에이전트 출근은 subagents/ 트랜스크립트 발견 시점에 subagent_spawn으로 발행
              const isDelegation = toolName === 'Agent' || toolName === 'Task';
              events.push({
                ...base,
                id: `${idPrefix}_${item.id || i}_tool`,
                toolUseId: item.id || null,
                action: 'tool_start',
                room,
                toolName,
                toolSummary: isDelegation
                  ? `${input.subagent_type || 'agent'}: ${input.description || '작업 위임'}`
                  : JSON.stringify(input).slice(0, 100),
                toolArgs: input
              });
            }
          }
        }
      }

      if (msg.stop_reason === 'end_turn') {
        const textItems = Array.isArray(msg.content)
          ? msg.content.filter(c => c && c.type === 'text').map(c => c.text).join('\n').trim()
          : '';

        if (state.isSubagent) {
          events.push(subagentFinish(textItems));
          return events;
        }

        const summaryText = textItems ? textItems.slice(0, 150) : '턴 종료 및 결과 보고';
        const isQuestion = Boolean(textItems) && QUESTION_REGEX.test(textItems);
        events.push({
          ...base,
          id: `${idPrefix}_${obj.uuid || now}_end`,
          action: isQuestion ? 'ask_user' : 'turn_finish',
          room: 'user_desk',
          questionText: isQuestion ? summaryText : undefined,
          resultSummary: summaryText
        });
      }
      return events;
    }

    return events;
  } catch (err) {
    return [];
  }
}

module.exports = {
  cleanPrompt,
  parseClaudeLine
};
