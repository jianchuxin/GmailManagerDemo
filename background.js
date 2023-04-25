chrome.identity.getProfileUserInfo((userInfo) => {
  if (userInfo.id) {
    console.log("id:", userInfo.email);
    console.log(`user login in, email: ${userInfo.email} `);
    run();
  } else {
    console.log(
      "didn't work: this extension works after you login your google account. "
    );
  }
});

// chrome.identity.onSignInChanged.addListener(onSignInChanged);
// function onSignInChanged(account, isSignedIn) {
//   console.log("Account:", account);
//   console.log("Signed in/out:", isSignedIn);
//   if (isSignedIn) {
//     console.log("user login in, this extension starts working..");
//     getUnreadEmails();
//     run();
//   } else {
//     chrome.alarms.clear("emailCheckAlarm");
//     console.log("user login out, this extension stop work.");
//   }
// }

// getUnreadEmails();
// // 这里要用alarms而不是setInterval, 设置一个计数器，到时调用函数检查是否有新邮件
// chrome.alarms.create("emailCheckAlarm", { periodInMinutes: 0.5 });
// chrome.alarms.onAlarm.addListener((alarm) => {
//   if (alarm.name === "emailCheckAlarm") {
//     getUnreadEmails();
//   }
// });

function run() {
  getUnreadEmails();
  // 这里要用alarms而不是setInterval, 设置一个计数器，到时调用函数检查是否有新邮件
  chrome.alarms.create("emailCheckAlarm", { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener(alarmListener);
}

function alarmListener(alarm) {
  if (alarm.name === "emailCheckAlarm") {
    getUnreadEmails();
  }
}

//获取访问令牌
function getAccessToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        console.log(chrome.runtime.lastError);
        reject(chrome.runtime.lastError);
      } else {
        resolve(token);
      }
    });
  });
}

//获取未读邮件
async function getUnreadEmails() {
  const accessToken = await getAccessToken();
  // console.log(accessToken);
  // await getAccessToken()
  // .then((token)=>{},())
  // 定义一个存储数组， 存储已通知的新邮件的id， 避免重复通知
  let notificatedMessages = [];
  await chrome.storage.local.get(["ntfm"]).then((result) => {
    if (result.ntfm) {
      notificatedMessages = result.ntfm;
      console.log(`${notificatedMessages.length} emails were stored at local`);
      // console.log("last notificatedMessage :", notificatedMessages);
    }
  });
  //读取未读邮件
  const url =
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread";
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
  //读取失败，可能由于用户注销或者令牌失效
  if (!response.ok) {
    chrome.identity.removeCachedAuthToken({ token: accessToken });
    chrome.alarms.clear("emailCheckAlarm");
    chrome.alarms.onAlarm.removeListener(alarmListener);
    throw new Error(
      `Failed to fetch unread emails: ${response.status} ${response.statusText}`
    );
  }
  //处理未读邮件
  const data = await response.json();
  setIconBadge(data.resultSizeEstimate);
  if (data.resultSizeEstimate > 0) {
    console.log(data);
    const messages = data.messages;
    messages.reverse();
    for (let message of messages) {
      const messageId = message.id;
      if (!notificatedMessages.includes(messageId)) {
        // 根据邮件的id读取邮件的详细信息
        const urlMessage = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`;
        const response = await fetch(urlMessage, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-type": "application-json",
          },
        });
        const emailDetail = await response.json();
        // 弹出通知
        createNotification(accessToken, emailDetail);
        notificatedMessages.push(message.id);
      }
    }
    // 在local storage中设置存储数组
    chrome.storage.local.set({ ntfm: notificatedMessages }).then(() => {
      console.log("new email is stored");
    });
  }
}

function setIconBadge(unreadEmailNum) {
  chrome.action.setBadgeBackgroundColor({
    color: unreadEmailNum === 0 ? "#fff" : "#e03131",
  });
  chrome.action.setBadgeText({
    text: unreadEmailNum === 0 ? "" : unreadEmailNum.toString(),
  });
}

// function removeIconBadge() {
//   chrome.action.setBadgeBackgroundColor({
//     color: "#fff",
//   });
//   chrome.action.setBadgeText({
//     text: "",
//   });
// }

async function createNotification(accessToken, emailDetail) {
  let isThereAttachment = false;
  // console.log("emailDetail:", emailDetail);
  //创建一个通知，显示邮件的主题和信息
  const headers = emailDetail.payload.headers;
  const Snippet = emailDetail.snippet;
  let Subject = "";
  for (let obj of headers) {
    if (obj.name === "Subject") {
      Subject = obj.value;
      break;
    }
  }
  //显示附件和附件类型
  const payload = emailDetail.payload;
  let attachmentPart;
  let attachmentId = "";
  let filename = "";
  if (payload.parts && payload.parts.length > 0) {
    for (let part of payload.parts) {
      if (part.body.attachmentId) {
        isThereAttachment = true;
        attachmentPart = part;
        break;
      }
    }
  }
  //没有附件时的通知
  let notificationOption = {
    type: "basic",
    iconUrl: "images/icon-32.png",
    title: "🔔 Get an New Email",
    message: `Receive a new email\nsubject: ${Subject}\nSnippet: ${Snippet}\n`,
    buttons: [{ title: "Go To Inbox" }],
  };
  //有附件时的通知， 多加个一个下载附件的按钮
  let base64urlAttachment = "";
  if (isThereAttachment) {
    filename = attachmentPart.filename;
    notificationOption.message += `attachment: ${filename}`;
    attachmentId = attachmentPart.body.attachmentId;
    const urlAttachment = `https://gmail.googleapis.com/gmail/v1/users/me/messages//attachments/${attachmentId}`;
    const responseAttachment = await fetch(urlAttachment, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    base64urlAttachment = await responseAttachment.json();
    console.log("附件信息如下:", base64urlAttachment);
    //添加一个按钮，用wps打开该附件
    const button2 = {
      title: "Open With WPS",
    };
    notificationOption.buttons.push(button2);
  }
  let notificationId;
  await chrome.notifications.create(notificationOption, (id) => {
    notificationId = id;
  });

  if (notificationOption.buttons.length === 1) {
    chrome.notifications.onButtonClicked.addListener(function clickListener(
      id
    ) {
      console.log("id:", id);
      if (id === notificationId) {
        chrome.tabs.create({ url: "https://mail.google.com/mail/u/0/#inbox'" });
      }
      chrome.notifications.onButtonClicked.removeListener(clickListener);
    });
  } else if (notificationOption.buttons.length === 2) {
    chrome.notifications.onButtonClicked.addListener(function clickListener(
      id,
      buttonIndex
    ) {
      console.log(notificationId, id);
      if (id === notificationId) {
        if (buttonIndex === 0) {
          chrome.tabs.create({
            url: "https://mail.google.com/mail/u/0/#inbox'",
          });
        } else if (buttonIndex === 1) {
          let mimeType = "application/";
          if (filename.indexOf(".") != -1) {
            const fileType = filename.slice(filename.indexOf(".") + 1);
            // console.log(fileType);
            mimeType += fileType;
          } else {
            mimeType = "text/plain";
          }
          console.log(`使用wps打开附件(${mimeType})`);
          //转换为正规的base64格式
          const base64Attachment = base64urlAttachment.data
            .replace(/-/g, "+")
            .replace(/_/g, "/");
          const dataUrl = "data:" + mimeType + ";base64," + base64Attachment;
          chrome.downloads.download({
            url: dataUrl,
            filename,
          });
        }
      }
      chrome.notifications.onButtonClicked.removeListener(clickListener);
    });
  }
}
