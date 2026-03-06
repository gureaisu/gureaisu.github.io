const WebSocket = require('ws');

const PORT = 9001;
const wss  = new WebSocket.Server({ port: PORT });

let memberCounter = 1;  // Mock 玩家 ID 自動遞增

console.log(`✅ WebSocket Server 啟動，監聽 port ${PORT}`);
console.log(`   連線網址：ws://127.0.0.1:${PORT}`);
console.log('----------------------------------------');

// 每個連線進來
wss.on('connection', (ws) => {
    console.log(`[+] 新連線 (目前共 ${wss.clients.size} 個連線)`);

    let loginUser = null;  // 記錄此連線登入的玩家

    // 收到訊息
    ws.on('message', (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch {
            console.error('❌ JSON 解析失敗:', raw);
            return;
        }

        const cmd  = msg.cmd;
        const data = msg.data;
        console.log(`↑ 收到 [${cmd}]`, JSON.stringify(data));

        // 依指令回應
        switch (cmd) {

            // 心跳
            case 'sschk':
                send(ws, { cmd: 'sschk', status: ok() });
                break;

            // 玩家登入
            case 'ln': {
                const id       = memberCounter++;
                const account  = `user_${id}`;
                loginUser = { id, account };
                send(ws, {
                    cmd: 'ln',
                    status: ok(),
                    data: {
                        memberId:     id,
                        account:      account,
                        nickname:     account,
                        photoID:      0,
                        coinType:     0,
                        pointGold:    100000.0,
                        pointSilver:  100000.0,
                        spreadCode:   '',
                    }
                });
                console.log(`   👤 玩家登入：${account}`);
                break;
            }

            // 取級別列表
            case 'lbll':
                send(ws, {
                    cmd: 'lbll',
                    status: ok(),
                    data: {
                        gameID: data.gameID,
                        types: [
                            { typeID: 1, typeName: '一般場', levels: [
                                { levelID: 1, levelName: '初級場', minBet: 100 },
                                { levelID: 2, levelName: '中級場', minBet: 500 },
                            ]},
                        ]
                    }
                });
                break;

            // 取房間列表
            case 'lbrl':
                send(ws, {
                    cmd: 'lbrl',
                    status: ok(),
                    data: {
                        gameID:  data.gameID,
                        typeID:  data.typeID,
                        levelID: data.levelID,
                        rooms: [
                            { roomNo: 1, playerCount: 3, maxCount: 10, status: 1 },
                            { roomNo: 2, playerCount: 7, maxCount: 10, status: 1 },
                            { roomNo: 3, playerCount: 0, maxCount: 10, status: 0 },
                        ]
                    }
                });
                break;

            // 進入遊戲房
            case 'lbsr':
                send(ws, {
                    cmd:    'goin',
                    status: ok(),
                    data: {
                        roomNo:      data.roomNo,
                        playerCount: 4,
                    }
                });
                console.log(`   🎮 ${loginUser?.account ?? '?'} 進入房間 ${data.roomNo}`);
                break;

            // 返回大廳
            case 'pwlby':
                send(ws, { cmd: 'pwlby', status: ok() });
                console.log(`   🏠 ${loginUser?.account ?? '?'} 返回大廳`);
                break;

            // 玩家主動登出
            case 'usdis':
                send(ws, { cmd: 'ssdis', data: { code: '0' } });
                console.log(`   👋 ${loginUser?.account ?? '?'} 主動登出`);
                ws.close();
                break;

            // 後台心跳
            case 'checkIsLive':
                send(ws, {
                    cmd:      'checkIsLive',
                    status:   ok(),
                    datetime: new Date().toISOString(),
                    data:     []
                });
                break;

            default:
                console.log(`   ⚠️  未處理的指令: ${cmd}`);
                send(ws, { cmd, status: { code: '9999', msg: `未知指令: ${cmd}` } });
        }
    });

    // 連線關閉
    ws.on('close', () => {
        console.log(`[-] 連線關閉 ${loginUser ? `(${loginUser.account})` : ''} (剩 ${wss.clients.size} 個連線)`);
    });

    // 錯誤
    ws.on('error', (err) => {
        console.error('⚠️  連線錯誤:', err.message);
    });
});


// 工具函式：送訊息
function send(ws, obj) {
    if (ws.readyState === WebSocket.OPEN) {
        const str = JSON.stringify(obj);
        ws.send(str);
        console.log(`↓ 回應 [${obj.cmd}]`, JSON.stringify(obj.data ?? obj.status));
    }
}

// 工具函式：成功狀態
function ok() {
    return { code: '0', msg: '' };
}
