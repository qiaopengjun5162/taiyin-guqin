//! # taiyin-server
//!
//! 太音 · Axum 后端 API 服务。

pub mod db;
mod error;
mod models;
mod routes;

pub use db::AppState;
pub use routes::app;
