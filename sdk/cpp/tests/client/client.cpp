/**
 * Copyright 2018-2020 Pejman Ghorbanzade. All rights reserved.
 */

#include "weasel/detail/client.hpp"
#include "catch2/catch.hpp"
#include "devkit/tmpfile.hpp"
#include "rapidjson/document.h"
#include "rapidjson/stringbuffer.h"
#include "rapidjson/writer.h"
#include "weasel/devkit/resultfile.hpp"
#include "weasel/devkit/utils.hpp"

using namespace weasel;

std::string saveAndReadBack(const weasel::ClientImpl& client)
{
    TmpFile file;
    CHECK_NOTHROW(client.save(file.path, {}, DataFormat::JSON, true));
    return load_string_file(file.path);
}

ElementsMap saveAndLoadBack(const weasel::ClientImpl& client)
{
    TmpFile file;
    CHECK_NOTHROW(client.save(file.path, {}, DataFormat::FBS, true));
    ResultFile resultFile(file.path);
    return resultFile.parse();
}

/**
 * Calling post for a client with no testcase should be successful.
 */
TEST_CASE("empty client")
{
    weasel::ClientImpl client;
    REQUIRE(client.is_configured() == false);
    CHECK(client.configuration_error().empty() == true);
    REQUIRE_NOTHROW(client.configure({ { "api-key", "some-secret-key" },
                                       { "api-url", "http://localhost:8081" },
                                       { "team", "myteam" },
                                       { "suite", "mysuite" },
                                       { "version", "myversion" },
                                       { "handshake", "false" } }));
    CHECK(client.is_configured() == true);
    CHECK(client.configuration_error().empty() == true);

    SECTION("post")
    {
        REQUIRE_NOTHROW(client.post());
        CHECK(client.post());
    }

    SECTION("save")
    {
        const auto& output = saveAndReadBack(client);
        CHECK(output == "[]");
    }
}

TEST_CASE("using a configured client")
{
    weasel::ClientImpl client;
    const weasel::ClientImpl::OptionsMap options_map = {
        { "team", "myteam" },
        { "suite", "mysuite" },
        { "version", "myversion" },
        { "handshake", "false" }
    };
    REQUIRE_NOTHROW(client.configure(options_map));
    REQUIRE(client.is_configured() == true);
    CHECK(client.configuration_error().empty() == true);

    /**
     *
     */
    SECTION("testcase switch")
    {
        CHECK_NOTHROW(client.add_hit_count("ignored-key"));
        CHECK(client.testcase("some-case"));
        CHECK_NOTHROW(client.add_hit_count("some-key"));
        CHECK(client.testcase("some-other-case"));
        CHECK_NOTHROW(client.add_hit_count("some-other-key"));
        CHECK(client.testcase("some-case"));
        CHECK_NOTHROW(client.add_hit_count("some-other-key"));
        const auto& content = saveAndLoadBack(client);
        REQUIRE(content.count("some-case"));
        REQUIRE(content.count("some-other-case"));
        CHECK(content.at("some-case")->overview().keysCount == 2);
        CHECK(content.at("some-other-case")->overview().keysCount == 1);
    }

    /**
     *
     */
    SECTION("results")
    {
        client.testcase("some-case");
        const auto& v1 = std::make_shared<types::Bool>(true);
        CHECK_NOTHROW(client.add_result("some-value", v1));
        CHECK_NOTHROW(client.add_hit_count("some-other-value"));
        CHECK_NOTHROW(client.add_array_element("some-array-value", v1));
        const auto& content = saveAndReadBack(client);
        const auto& expected = R"("results":[{"key":"some-array-value","value":"[true]"},{"key":"some-other-value","value":"1"},{"key":"some-value","value":"true"}])";
        CHECK_THAT(content, Catch::Contains(expected));
    }

    /**
     * bug
     */
    SECTION("assertions")
    {
        client.testcase("some-case");
        const auto& v1 = std::make_shared<types::Bool>(true);
        CHECK_NOTHROW(client.add_assertion("some-value", v1));
        const auto& content = saveAndReadBack(client);
        const auto& expected = R"([])";
        CHECK_THAT(content, Catch::Contains(expected));
    }

    SECTION("metrics")
    {
        const auto& tc = client.testcase("some-case");
        CHECK(tc->metrics().empty());
        CHECK_NOTHROW(client.start_timer("a"));
        CHECK(tc->metrics().empty());
        CHECK_THROWS_AS(client.stop_timer("b"), std::invalid_argument);
        CHECK_NOTHROW(client.start_timer("b"));
        CHECK(tc->metrics().empty());
        CHECK_NOTHROW(client.stop_timer("b"));
        CHECK(tc->metrics().size() == 1);
        CHECK(tc->metrics().count("b"));
        const auto& content = saveAndReadBack(client);
        const auto& expected = R"("results":[],"assertion":[],"metrics":[{"key":"b","value":"0"}])";
        CHECK_THAT(content, Catch::Contains(expected));
    }

    /**
     *
     */
    SECTION("forget_testcase")
    {
        client.testcase("some-case");
        const auto& v1 = std::make_shared<types::Bool>(true);
        client.add_result("some-value", v1);
        client.add_assertion("some-assertion", v1);
        client.start_timer("some-metric");
        client.stop_timer("some-metric");
        client.forget_testcase("some-case");
        const auto& content = saveAndReadBack(client);
        CHECK_THAT(content, Catch::Contains(R"([])"));
    }

    /**
     * Calling post when client is locally configured should throw exception.
     */
    SECTION("post")
    {
        REQUIRE_NOTHROW(client.testcase("mycase"));
        REQUIRE_THROWS_AS(client.post(), std::runtime_error);
        REQUIRE_THROWS_WITH(client.post(), Catch::Contains("not configured"));
    }
}