// Copyright 2021 Touca, Inc. Subject to Apache-2.0 License.

#include "worker.hpp"

#include <thread>

#include "platform.hpp"
#include "touca/devkit/logger.hpp"
#include "touca/devkit/platform.hpp"

/**
 *
 */
void collector(const Options& options, Resources& resources) {
  namespace chr = std::chrono;
  const auto& interval = chr::milliseconds(options.polling_interval);

  while (true) {
    TOUCA_LOG_DEBUG("polling for new comparison jobs");
    const auto& tic = chr::system_clock::now();
    auto jobs = retrieveJobs(options.api_url);

    // if there is no job, we have nothing to do but wait

    if (jobs.empty()) {
      std::this_thread::sleep_for(interval);
      continue;
    }

    // update statistics

    TOUCA_LOG_INFO("received {} comparison jobs", jobs.size());
    const auto& toc = chr::system_clock::now();
    const auto& dur = chr::duration_cast<chr::milliseconds>(toc - tic);
    resources.stats.update_collector_stats(dur.count(), jobs.size());

    // push jobs into queue for async processing

    for (auto& job : jobs) {
      resources.job_queue.push_item(std::move(job));
    }
  }
}

/**
 *
 */
void reporter(const Options& options, Resources& resources) {
  namespace chr = std::chrono;
  const auto& interval = chr::milliseconds(options.status_report_interval);
  std::string previous = "";
  while (true) {
    std::this_thread::sleep_for(interval);
    const auto& report = resources.stats.report();
    if (!report.compare(previous)) {
      continue;
    }
    TOUCA_LOG_INFO("{}", report);
    previous = report;
    if (resources.stats.job_count_collect == 0 ||
        resources.stats.job_count_process == 0) {
      continue;
    }
    touca::ApiUrl api(options.api_url);
    touca::Platform platform(api);
    if (!platform.cmp_stats(report)) {
      TOUCA_LOG_WARN("failed to report statistics: {}", platform.get_error());
    }
    resources.stats.reset();
  }
}

/**
 *
 */
void processor(const Options& options, Resources& resources) {
  namespace chr = std::chrono;
  while (true) {
    const auto job = resources.job_queue.pop_item();
    const auto desc = job->desc();
    TOUCA_LOG_DEBUG("{}: processing", desc);
    const auto& tic = chr::system_clock::now();

    if (!job->process(options)) {
      TOUCA_LOG_ERROR("{}: failed to process job", desc);
      continue;
    }

    // log that comparison job was processed

    const auto& toc = chr::system_clock::now();
    const auto& dur = chr::duration_cast<chr::milliseconds>(toc - tic);
    TOUCA_LOG_INFO("{}: processed ({} ms)", desc, dur.count());
    resources.stats.update_processor_stats(dur.count());
  }
}
