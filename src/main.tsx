import React from "react";
import ReactDOM from "react-dom/client";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/zh-cn";
import App from "./App";

// 全局 dayjs 配置集中在入口，避免被某个页面的 import 副作用悄悄改掉。
// 注意 zh-cn 的 weekStart 是 1（周一），凡涉及周起止的计算都不要依赖
// startOf('week') / endOf('week') 的隐式周起点。
dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
