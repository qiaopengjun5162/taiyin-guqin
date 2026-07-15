//! # taiyin-server
//!
//! 太音 · Axum 后端 API 服务。

pub mod db;
mod error;
pub mod llm;
mod models;
mod routes;

pub use db::AppState;
pub use routes::app;
