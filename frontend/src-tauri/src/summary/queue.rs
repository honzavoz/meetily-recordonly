use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use tokio::sync::{Mutex, Notify};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SummaryJobPhase {
    Reserved,
    Queued,
    Running,
    Cancelling,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SummaryJobView {
    pub job_id: String,
    pub meeting_id: String,
    pub phase: SummaryJobPhase,
    pub queue_position: Option<usize>,
}

pub enum ReservationOutcome {
    New {
        view: SummaryJobView,
        token: CancellationToken,
    },
    Existing(SummaryJobView),
}

pub enum CancelOutcome {
    Queued(SummaryJobView),
    Running(SummaryJobView),
    NotActive,
}

struct JobEntry {
    meeting_id: String,
    phase: SummaryJobPhase,
    token: CancellationToken,
}

#[derive(Default)]
struct QueueState {
    waiting: VecDeque<String>,
    jobs: HashMap<String, JobEntry>,
    meeting_jobs: HashMap<String, String>,
    running: Option<String>,
}

impl QueueState {
    fn view(&self, job_id: &str) -> Option<SummaryJobView> {
        let entry = self.jobs.get(job_id)?;
        let queue_position = if entry.phase == SummaryJobPhase::Queued {
            self.waiting
                .iter()
                .position(|queued_id| queued_id == job_id)
                .map(|index| index + 1)
        } else {
            None
        };

        Some(SummaryJobView {
            job_id: job_id.to_string(),
            meeting_id: entry.meeting_id.clone(),
            phase: entry.phase.clone(),
            queue_position,
        })
    }

    fn owns(&self, meeting_id: &str, job_id: &str) -> bool {
        self.meeting_jobs
            .get(meeting_id)
            .is_some_and(|active_id| active_id == job_id)
    }

    fn remove_exact(&mut self, meeting_id: &str, job_id: &str) -> bool {
        if !self.owns(meeting_id, job_id) {
            return false;
        }

        self.waiting.retain(|queued_id| queued_id != job_id);
        if self.running.as_deref() == Some(job_id) {
            self.running = None;
        }
        self.jobs.remove(job_id);
        self.meeting_jobs.remove(meeting_id);
        true
    }
}

pub struct SummaryQueueManager {
    state: Mutex<QueueState>,
    changed: Notify,
}

impl Default for SummaryQueueManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SummaryQueueManager {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(QueueState::default()),
            changed: Notify::new(),
        }
    }

    pub async fn reserve(&self, meeting_id: &str) -> ReservationOutcome {
        let mut state = self.state.lock().await;
        if let Some(job_id) = state.meeting_jobs.get(meeting_id) {
            return ReservationOutcome::Existing(
                state
                    .view(job_id)
                    .expect("meeting-to-job index must point to an active job"),
            );
        }

        let job_id = Uuid::new_v4().to_string();
        let token = CancellationToken::new();
        state.jobs.insert(
            job_id.clone(),
            JobEntry {
                meeting_id: meeting_id.to_string(),
                phase: SummaryJobPhase::Reserved,
                token: token.clone(),
            },
        );
        state
            .meeting_jobs
            .insert(meeting_id.to_string(), job_id.clone());

        ReservationOutcome::New {
            view: state
                .view(&job_id)
                .expect("newly reserved job must be visible"),
            token,
        }
    }

    pub async fn commit(&self, job_id: &str) -> Result<SummaryJobView, String> {
        let mut state = self.state.lock().await;
        let entry = state
            .jobs
            .get_mut(job_id)
            .ok_or_else(|| format!("Unknown summary job: {job_id}"))?;
        if entry.phase != SummaryJobPhase::Reserved {
            return Err(format!("Summary job {job_id} is already committed"));
        }
        entry.phase = SummaryJobPhase::Queued;
        state.waiting.push_back(job_id.to_string());
        let view = state
            .view(job_id)
            .expect("committed job must remain visible");
        drop(state);
        self.changed.notify_waiters();
        Ok(view)
    }

    pub async fn release_reservation(&self, meeting_id: &str, job_id: &str) -> bool {
        let mut state = self.state.lock().await;
        let is_reserved = state
            .jobs
            .get(job_id)
            .is_some_and(|entry| entry.phase == SummaryJobPhase::Reserved);
        let removed = is_reserved && state.remove_exact(meeting_id, job_id);
        drop(state);
        if removed {
            self.changed.notify_waiters();
        }
        removed
    }

    pub async fn wait_for_turn(
        &self,
        job_id: &str,
        token: &CancellationToken,
    ) -> Result<SummaryJobView, String> {
        loop {
            let notified = self.changed.notified();
            {
                let mut state = self.state.lock().await;
                let entry = state
                    .jobs
                    .get(job_id)
                    .ok_or_else(|| format!("Summary job {job_id} is no longer active"))?;
                if token.is_cancelled() || entry.token.is_cancelled() {
                    return Err(format!("Summary job {job_id} was cancelled"));
                }

                if state.running.is_none()
                    && state.waiting.front().is_some_and(|front| front == job_id)
                {
                    state.waiting.pop_front();
                    state.running = Some(job_id.to_string());
                    state
                        .jobs
                        .get_mut(job_id)
                        .expect("granted job must exist")
                        .phase = SummaryJobPhase::Running;
                    return state
                        .view(job_id)
                        .ok_or_else(|| format!("Summary job {job_id} disappeared"));
                }
            }

            tokio::select! {
                _ = notified => {},
                _ = token.cancelled() => {
                    return Err(format!("Summary job {job_id} was cancelled"));
                }
            }
        }
    }

    pub async fn cancel(&self, meeting_id: &str, job_id: &str) -> CancelOutcome {
        let mut state = self.state.lock().await;
        if !state.owns(meeting_id, job_id) {
            return CancelOutcome::NotActive;
        }
        let Some(phase) = state.jobs.get(job_id).map(|entry| entry.phase.clone()) else {
            return CancelOutcome::NotActive;
        };

        match phase {
            SummaryJobPhase::Reserved => {
                let entry = state
                    .jobs
                    .get_mut(job_id)
                    .expect("owned reserved job must exist");
                entry.token.cancel();
                entry.phase = SummaryJobPhase::Cancelling;
                let view = state
                    .view(job_id)
                    .expect("owned reserved job must be visible");
                drop(state);
                self.changed.notify_waiters();
                CancelOutcome::Running(view)
            }
            SummaryJobPhase::Queued => {
                let mut view = state
                    .view(job_id)
                    .expect("owned queued job must be visible");
                view.phase = SummaryJobPhase::Queued;
                state
                    .jobs
                    .get(job_id)
                    .expect("owned queued job must exist")
                    .token
                    .cancel();
                state.remove_exact(meeting_id, job_id);
                drop(state);
                self.changed.notify_waiters();
                CancelOutcome::Queued(view)
            }
            SummaryJobPhase::Running | SummaryJobPhase::Cancelling => {
                let entry = state
                    .jobs
                    .get_mut(job_id)
                    .expect("owned running job must exist");
                entry.token.cancel();
                entry.phase = SummaryJobPhase::Cancelling;
                let view = state
                    .view(job_id)
                    .expect("owned running job must be visible");
                drop(state);
                self.changed.notify_waiters();
                CancelOutcome::Running(view)
            }
        }
    }

    pub async fn finish(&self, meeting_id: &str, job_id: &str) -> bool {
        let mut state = self.state.lock().await;
        let removed = state.remove_exact(meeting_id, job_id);
        drop(state);
        if removed {
            self.changed.notify_waiters();
        }
        removed
    }

    pub async fn view_for_meeting(&self, meeting_id: &str) -> Option<SummaryJobView> {
        let state = self.state.lock().await;
        let job_id = state.meeting_jobs.get(meeting_id)?;
        state.view(job_id)
    }

    pub async fn active_count(&self) -> usize {
        self.state.lock().await.jobs.len()
    }
}

pub static SUMMARY_QUEUE: Lazy<SummaryQueueManager> = Lazy::new(SummaryQueueManager::new);

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn grants_jobs_in_fifo_order_and_only_one_runs() {
        let queue = SummaryQueueManager::new();
        let ReservationOutcome::New {
            view: first,
            token: first_token,
        } = queue.reserve("meeting-a").await
        else {
            panic!("expected new job")
        };
        let ReservationOutcome::New {
            view: second,
            token: second_token,
        } = queue.reserve("meeting-b").await
        else {
            panic!("expected new job")
        };
        let ReservationOutcome::New {
            view: third,
            token: third_token,
        } = queue.reserve("meeting-c").await
        else {
            panic!("expected new job")
        };

        queue.commit(&first.job_id).await.unwrap();
        queue.commit(&second.job_id).await.unwrap();
        queue.commit(&third.job_id).await.unwrap();

        assert_eq!(
            queue
                .wait_for_turn(&first.job_id, &first_token)
                .await
                .unwrap()
                .job_id,
            first.job_id
        );
        assert!(tokio::time::timeout(
            Duration::from_millis(20),
            queue.wait_for_turn(&second.job_id, &second_token),
        )
        .await
        .is_err());
        assert_eq!(
            queue
                .view_for_meeting("meeting-b")
                .await
                .unwrap()
                .queue_position,
            Some(1)
        );
        assert_eq!(
            queue
                .view_for_meeting("meeting-c")
                .await
                .unwrap()
                .queue_position,
            Some(2)
        );

        assert!(queue.finish("meeting-a", &first.job_id).await);
        assert_eq!(
            queue
                .wait_for_turn(&second.job_id, &second_token)
                .await
                .unwrap()
                .job_id,
            second.job_id
        );
        assert!(!third_token.is_cancelled());
    }

    #[tokio::test]
    async fn duplicate_reservation_returns_existing_job() {
        let queue = SummaryQueueManager::new();
        let ReservationOutcome::New { view: first, .. } = queue.reserve("meeting-a").await else {
            panic!("expected new job")
        };
        let ReservationOutcome::Existing(duplicate) = queue.reserve("meeting-a").await else {
            panic!("expected existing job")
        };

        assert_eq!(duplicate.job_id, first.job_id);
        assert_eq!(queue.active_count().await, 1);
    }

    #[tokio::test]
    async fn queued_cancellation_removes_only_the_target_job() {
        let queue = SummaryQueueManager::new();
        let ReservationOutcome::New {
            view: first,
            token: first_token,
        } = queue.reserve("meeting-a").await
        else {
            panic!("expected new job")
        };
        let ReservationOutcome::New { view: second, .. } = queue.reserve("meeting-b").await else {
            panic!("expected new job")
        };
        let ReservationOutcome::New { view: third, .. } = queue.reserve("meeting-c").await else {
            panic!("expected new job")
        };
        queue.commit(&first.job_id).await.unwrap();
        queue.commit(&second.job_id).await.unwrap();
        queue.commit(&third.job_id).await.unwrap();
        let _ = queue
            .wait_for_turn(&first.job_id, &first_token)
            .await
            .unwrap();

        assert!(matches!(
            queue.cancel("meeting-b", &second.job_id).await,
            CancelOutcome::Queued(_)
        ));
        assert!(queue.view_for_meeting("meeting-b").await.is_none());
        assert_eq!(
            queue
                .view_for_meeting("meeting-c")
                .await
                .unwrap()
                .queue_position,
            Some(1)
        );
    }

    #[tokio::test]
    async fn running_cancellation_keeps_slot_until_worker_finishes() {
        let queue = SummaryQueueManager::new();
        let ReservationOutcome::New { view, token } = queue.reserve("meeting-a").await else {
            panic!("expected new job")
        };
        queue.commit(&view.job_id).await.unwrap();
        queue.wait_for_turn(&view.job_id, &token).await.unwrap();

        let CancelOutcome::Running(cancelling) = queue.cancel("meeting-a", &view.job_id).await
        else {
            panic!("expected running cancellation")
        };
        assert_eq!(cancelling.phase, SummaryJobPhase::Cancelling);
        assert!(token.is_cancelled());
        assert_eq!(queue.active_count().await, 1);
        assert!(queue.finish("meeting-a", &view.job_id).await);
        assert_eq!(queue.active_count().await, 0);
    }

    #[tokio::test]
    async fn reserved_cancellation_stays_owned_until_enqueue_finishes() {
        let queue = SummaryQueueManager::new();
        let ReservationOutcome::New { view, token } = queue.reserve("meeting-a").await else {
            panic!("expected new job")
        };

        let CancelOutcome::Running(cancelling) = queue.cancel("meeting-a", &view.job_id).await
        else {
            panic!("reserved cancellation must wait for command cleanup")
        };

        assert_eq!(cancelling.phase, SummaryJobPhase::Cancelling);
        assert!(token.is_cancelled());
        assert_eq!(queue.active_count().await, 1);
        assert!(queue.finish("meeting-a", &view.job_id).await);
        assert_eq!(queue.active_count().await, 0);
    }

    #[tokio::test]
    async fn old_job_cannot_remove_newer_meeting_state() {
        let queue = SummaryQueueManager::new();
        let ReservationOutcome::New { view: old, .. } = queue.reserve("meeting-a").await else {
            panic!("expected new job")
        };
        queue.release_reservation("meeting-a", &old.job_id).await;
        let ReservationOutcome::New { view: current, .. } = queue.reserve("meeting-a").await else {
            panic!("expected new job")
        };

        assert!(!queue.finish("meeting-a", &old.job_id).await);
        assert_eq!(
            queue.view_for_meeting("meeting-a").await.unwrap().job_id,
            current.job_id
        );
    }
}
