// Copyright 2022 Touca, Inc. Subject to Apache-2.0 License.

package io.touca.apps.sample;

import io.touca.Touca;
import java.util.Arrays;

public final class Students {

  public static Student findStudent(final String username) {
    sleep(200);
    StudentData data = StudentData.of(username);
    return new Student(data.username, data.fullname, data.dob,
        calculateGPA(data.courses));
  }

  private static double calculateGPA(final Course[] courses) {
    Touca.check("courses", courses);
    double sum =
        Arrays.asList(courses).stream().mapToDouble(item -> item.grade).sum();
    return courses.length == 0 ? 0.0 : sum / courses.length;
  }

  private static void sleep(final long delay) {
    try {
      Thread.sleep(delay + Double.valueOf(Math.random() * 50).longValue());
    } catch (InterruptedException ex) {
      Thread.currentThread().interrupt();
    }
  }
}
